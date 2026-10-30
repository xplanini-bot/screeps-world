
module.exports = {

    role: "berserkMiner",
    desiredCount: 1,

    targetRoom: "E26N55",

    // Отступаем за 20 тиков до появления хранителя E26N55
    retreatBeforeSpawnTicks: 10,

    // Тело: 6 WORK + 6 MOVE
    body: [
        WORK, WORK, WORK, WORK,
        WORK, WORK, WORK, WORK,

        MOVE, MOVE, MOVE, MOVE,
        MOVE, MOVE, MOVE, MOVE
    ],

    // Усиленное тело: 12 WORK + 12 MOVE
    advancedBody: [
        WORK, WORK, WORK, WORK, WORK, WORK,
        WORK, WORK, WORK, WORK, WORK, WORK,

        MOVE, MOVE, MOVE, MOVE, MOVE, MOVE,
        MOVE, MOVE, MOVE, MOVE, MOVE, MOVE
    ],

    // Роль и количество перевозчиков
    carrierRole: "berserkCarrier",
    carrierDesiredCount: 2,

    // Тело перевозчика: 10 CARRY + 10 MOVE
    carrierBody: [
        CARRY, CARRY, CARRY, CARRY, CARRY,
        CARRY, CARRY, CARRY, CARRY, CARRY,

        MOVE, MOVE, MOVE, MOVE, MOVE,
        MOVE, MOVE, MOVE, MOVE, MOVE
    ],


    manageSpawning: function (spawn) {
        if (!this.targetRoom || !spawn || spawn.spawning) {
            return;
        }
        const extensions = spawn.room.find(FIND_MY_STRUCTURES, {
            filter: structure =>
                structure.structureType === STRUCTURE_EXTENSION
        });

        const minerBody = extensions.length >= 30
            ? this.advancedBody
            : this.body;

        const squadId = "attackerSquad_" + this.targetRoom;
        const creeps = Object.values(Game.creeps);

        const miner = creeps.find(creep =>
            creep.memory.role === this.role &&
            creep.memory.targetRoom === this.targetRoom &&
            creep.memory.squadId === squadId
        );

        // Этап 1: создаём шахтёра.
        // Он сам войдёт в целевую комнату и найдёт
        // логово, выбранное боевым отрядом.
        if (!miner) {
            const cost = minerBody.reduce(
                (total, part) => total + BODYPART_COST[part],
                0
            );

            if (spawn.room.energyAvailable < cost) {
                return;
            }

            const name = "BerserkMiner_" + Game.time;

            const result = spawn.spawnCreep(
                minerBody,
                name,
                {
                    memory: {
                        role: this.role,
                        targetRoom: this.targetRoom,
                        homeRoomName: spawn.room.name,
                        squadId: squadId,
                        keeperLairId: null,
                        sourceId: null,
                        minePosition: null,
                        retreating: false,
                        retreatPosition: null
                    }
                }
            );

            if (result === OK) {
                console.log(
                    "[БЕШЕНЫЙ ШАХТЁР] Создан: " + name
                );
            }

            return;
        }

        // Этап 2: перевозчик создаётся только после шахтёра
        // и при наличии домашнего Storage.
        if (!spawn.room.storage) {
            return;
        }

        const carrierCount = creeps.filter(creep =>
            creep.memory.role === this.carrierRole &&
            creep.memory.squadId === squadId
        ).length;

        // Если нужное количество перевозчиков уже есть,
        // больше никого не создаём.
        if (carrierCount >= this.carrierDesiredCount) {
            return;
        }

        const cost = this.carrierBody.reduce(
            (total, part) => total + BODYPART_COST[part],
            0
        );

        if (spawn.room.energyAvailable < cost) {
            return;
        }

        const name = "BerserkCarrier_" + Game.time;

        const result = spawn.spawnCreep(
            this.carrierBody,
            name,
            {
                memory: {
                    role: this.carrierRole,
                    targetRoom: this.targetRoom,
                    homeRoomName: spawn.room.name,
                    squadId: squadId,
                    returningToStorage: false
                }
            }
        );

        if (result === OK) {
            console.log(
                "[БЕШЕНЫЙ ШАХТЁР] Создан перевозчик: " + name
            );
        }
    },


    // Находим выход из комнаты в направлении дома
    getHomewardExit: function (creep, homeRoomName) {
        const route = Game.map.findRoute(
            creep.room.name,
            homeRoomName
        );

        if (!Array.isArray(route) || route.length === 0) {
            return null;
        }

        const exits = creep.room.find(route[0].exit);

        return (
            creep.pos.findClosestByPath(exits) ||
            creep.pos.findClosestByRange(exits)
        );
    },

    // Выбираем проходимую позицию рядом с источником
    findMinePosition: function (creep, source) {
        const room = source.room;
        const candidates = [];

        for (let dx = -1; dx <= 1; dx++) {
            for (let dy = -1; dy <= 1; dy++) {
                if (dx === 0 && dy === 0) continue;

                const x = source.pos.x + dx;
                const y = source.pos.y + dy;

                if (x < 1 || x > 48 || y < 1 || y > 48) {
                    continue;
                }

                if (
                    room.getTerrain().get(x, y) === TERRAIN_MASK_WALL
                ) {
                    continue;
                }

                const structures = room.lookForAt(
                    LOOK_STRUCTURES,
                    x,
                    y
                );

                const blocked = structures.some(structure =>
                    OBSTACLE_OBJECT_TYPES.includes(
                        structure.structureType
                    )
                );

                if (blocked) continue;

                candidates.push(
                    new RoomPosition(x, y, room.name)
                );
            }
        }

        return (
            creep.pos.findClosestByPath(candidates) ||
            creep.pos.findClosestByRange(candidates)
        );
    },

    // Поведение перевозчика бешеного шахтёра
    runCarrier: function (creep) {
        if (creep.spawning) return;

        const homeRoomName = creep.memory.homeRoomName;
        const squadId = creep.memory.squadId;

        if (!homeRoomName || !squadId) return;

        const homeRoom = Game.rooms[homeRoomName];
        const storage = homeRoom && homeRoom.storage;

        const energy = creep.store[RESOURCE_ENERGY] || 0;

        // Находим своего шахтёра
        const miner = Object.values(Game.creeps).find(other =>
            other.memory.role === this.role &&
            other.memory.squadId === squadId &&
            !other.spawning
        );

        // Если шахтёр отступает или погиб,
        // перевозчик доставляет весь имеющийся груз в Storage
        if (
            energy > 0 &&
            (
                !miner ||
                miner.memory.retreating
            )
        ) {
            creep.memory.returningToStorage = true;
        }

        // После полной выгрузки начинаем следовать за шахтёром
        if (
            creep.memory.returningToStorage &&
            energy === 0
        ) {
            creep.memory.returningToStorage = false;
        }

        // Полный перевозчик отправляется в Storage
        if (creep.store.getFreeCapacity(RESOURCE_ENERGY) === 0) {
            creep.memory.returningToStorage = true;
        }

        // Собираем энергию из могилы Keeper,
        // которого охраняла наша шахта.
        const targetRoom = creep.memory.targetRoom;
        const freeCapacity =
            creep.store.getFreeCapacity(RESOURCE_ENERGY);

        const keeperLairId =
            miner && miner.memory.keeperLairId;

        const expectedKeeperName = keeperLairId
            ? "Keeper" + keeperLairId
            : null;

        let keeperAlive = false;
        let spawnSoon = false;

        if (
            miner &&
            keeperLairId &&
            creep.room.name === targetRoom &&
            !miner.memory.retreating
        ) {
            const lair = Game.getObjectById(keeperLairId);

            keeperAlive = creep.room
                .find(FIND_HOSTILE_CREEPS)
                .some(hostile =>
                    hostile.name === expectedKeeperName
                );

            spawnSoon =
                lair &&
                Number.isFinite(lair.ticksToSpawn) &&
                lair.ticksToSpawn <= this.retreatBeforeSpawnTicks;
        }

        const canLootKeeperTombstones =
            miner &&
            !miner.memory.retreating &&
            creep.room.name === targetRoom &&
            keeperLairId &&
            !keeperAlive &&
            !spawnSoon &&
            freeCapacity > 0;

        if (canLootKeeperTombstones) {
            const tombstones = creep.room.find(FIND_TOMBSTONES, {
                filter: tombstone =>
                    tombstone.creep &&
                    tombstone.creep.name === expectedKeeperName &&
                    tombstone.store[RESOURCE_ENERGY] > 0
            });

            // Сначала забираем энергию из ближайшей могилы.
            tombstones.sort((a, b) =>
                creep.pos.getRangeTo(a) -
                creep.pos.getRangeTo(b)
            );

            const tombstone = tombstones[0];

            if (tombstone) {
                const targetId = tombstone.id;

                if (
                    creep.memory.keeperTombstoneTargetId !== targetId
                ) {
                    console.log(
                        "[БЕШЕНЫЙ ПЕРЕВОЗЧИК " + creep.name +
                        "] Найдена могила Keeper: " +
                        tombstone.creep.name +
                        ", энергия: " +
                        tombstone.store[RESOURCE_ENERGY]
                    );

                    creep.memory.keeperTombstoneTargetId = targetId;
                }

                // Подходим к могиле.
                if (creep.pos.getRangeTo(tombstone) > 1) {
                    creep.moveTo(tombstone, {
                        range: 1,
                        reusePath: 5
                    });

                    return;
                }

                // Забираем столько энергии, сколько помещается.
                const amount = Math.min(
                    creep.store.getFreeCapacity(RESOURCE_ENERGY),
                    tombstone.store[RESOURCE_ENERGY]
                );

                if (amount > 0) {
                    const result = creep.withdraw(
                        tombstone,
                        RESOURCE_ENERGY,
                        amount
                    );

                    if (result === OK) {
                        console.log(
                            "[БЕШЕНЫЙ ПЕРЕВОЗЧИК " + creep.name +
                            "] Забираю " + amount +
                            " энергии из могилы Keeper."
                        );
                    } else if (result === ERR_NOT_IN_RANGE) {
                        creep.moveTo(tombstone, {
                            range: 1,
                            reusePath: 5
                        });
                    }
                }

                return;
            }

            delete creep.memory.keeperTombstoneTargetId;
        }

        // Режим доставки
        if (creep.memory.returningToStorage) {
            // Если Storage недоступен, возвращаемся домой
            if (!storage) {
                if (creep.room.name !== homeRoomName) {
                    creep.moveTo(
                        new RoomPosition(25, 25, homeRoomName),
                        { range: 20, reusePath: 10 }
                    );
                }

                return;
            }

            // Идём к Storage
            if (!creep.pos.isNearTo(storage)) {
                creep.moveTo(storage, {
                    range: 1,
                    reusePath: 10
                });

                return;
            }

            // Выгружаем всю энергию
            if (energy > 0) {
                const result = creep.transfer(
                    storage,
                    RESOURCE_ENERGY
                );

                if (result === ERR_NOT_IN_RANGE) {
                    creep.moveTo(storage, {
                        range: 1,
                        reusePath: 10
                    });
                }
            }

            return;
        }

        // Если шахтёр пока отсутствует, ждём дома
        if (!miner) {
            if (creep.room.name !== homeRoomName) {
                creep.moveTo(
                    new RoomPosition(25, 25, homeRoomName),
                    { range: 20, reusePath: 10 }
                );
            }

            return;
        }

        // Ищем выпавшую энергию именно на клетке шахтёра
        const droppedEnergy = miner.pos
            .lookFor(LOOK_RESOURCES)
            .filter(resource =>
                resource.resourceType === RESOURCE_ENERGY &&
                resource.amount > 0
            )
            .sort((a, b) => b.amount - a.amount)[0];

        if (droppedEnergy) {
            const result = creep.pickup(droppedEnergy);

            if (result === ERR_NOT_IN_RANGE) {
                creep.moveTo(droppedEnergy, {
                    range: 1,
                    reusePath: 3
                });
            }

            return;
        }

        // Энергии на клетке шахтёра пока нет —
        // держимся рядом с ним
        if (
            creep.pos.roomName !== miner.pos.roomName ||
            creep.pos.getRangeTo(miner) > 1
        ) {
            creep.moveTo(miner, {
                range: 1,
                reusePath: 3
            });
        }
    },

    // Основная логика бешеного шахтёра
    run: function (creep) {
        if (creep.spawning) return;

        const targetRoom = creep.memory.targetRoom;
        const homeRoomName = creep.memory.homeRoomName;

        if (!targetRoom || !homeRoomName) return;

        // Идём в целевую комнату
        if (creep.room.name !== targetRoom) {
            creep.moveTo(
                new RoomPosition(25, 25, targetRoom),
                { reusePath: 20 }
            );
            return;
        }


        // При первом запуске новой логики сбрасываем старую
        // привязку к шахте, полученную из прежнего Memory.attackerSquads.
        if (!creep.memory.targetSelectionVersion) {
            creep.memory.keeperLairId = null;
            creep.memory.sourceId = null;
            creep.memory.minePosition = null;
            creep.memory.targetSelectionVersion = 1;
        }

        let lair = creep.memory.keeperLairId
            ? Game.getObjectById(creep.memory.keeperLairId)
            : null;

        // Если логово ещё не выбрано, читаем выбор стрелка.
        if (!lair || lair.structureType !== STRUCTURE_KEEPER_LAIR) {
            const attacker = Object.values(Game.creeps).find(other => {
                if (
                    other.spawning ||
                    other.memory.role !== "attacker" ||
                    other.room.name !== targetRoom
                ) {
                    return false;
                }

                const positions = other.memory.attackerPositions;

                return (
                    positions &&
                    positions.roomName === targetRoom &&
                    positions.lair &&
                    positions.lair.roomName === targetRoom
                );
            });

            // Ждём, пока стрелок выберет шахту.
            if (!attacker) {
                if (Game.time % 25 === 0) {
                    console.log(
                        "[БЕШЕНЫЙ ШАХТЁР] Ожидаю выбора шахты " +
                        "боевым отрядом в " + targetRoom
                    );
                }

                return;
            }

            const lairPosition =
                attacker.memory.attackerPositions.lair;

            const structures = creep.room.lookForAt(
                LOOK_STRUCTURES,
                lairPosition.x,
                lairPosition.y
            );

            lair = structures.find(structure =>
                structure.structureType === STRUCTURE_KEEPER_LAIR
            );

            if (!lair) {
                if (Game.time % 25 === 0) {
                    console.log(
                        "[БЕШЕНЫЙ ШАХТЁР] Не найдено логово по координатам " +
                        lairPosition.x + "," + lairPosition.y
                    );
                }

                return;
            }

            // Запоминаем выбранное боевым отрядом логово.
            creep.memory.keeperLairId = lair.id;
            creep.memory.sourceId = null;
            creep.memory.minePosition = null;

            console.log(
                "[БЕШЕНЫЙ ШАХТЁР] Выбрана шахта боевого отряда. " +
                "Логово: " + lair.id +
                ", координаты: " + lair.pos.x + "," + lair.pos.y
            );
        }


        // Назначаем источник рядом с выбранным логовом
        let source = creep.memory.sourceId
            ? Game.getObjectById(creep.memory.sourceId)
            : null;

        if (!source || source.room.name !== targetRoom) {
            const sources = creep.room.find(FIND_SOURCES);
            source = lair.pos.findClosestByRange(sources);

            if (!source) {
                if (Game.time % 25 === 0) {
                    console.log(
                        "[БЕШЕНЫЙ ШАХТЁР] Не найден источник у логова " +
                        lair.id
                    );
                }
                return;
            }

            creep.memory.sourceId = source.id;
            creep.memory.minePosition = null;

            console.log(
                "[БЕШЕНЫЙ ШАХТЁР] Назначен источник: " +
                source.id + ", логово: " + lair.id
            );
        }

        // Ищем именно хранителя, соответствующего этому логову
        const keeperName = "Keeper" + lair.id;

        const keeperAlive = creep.room
            .find(FIND_HOSTILE_CREEPS)
            .some(hostile => hostile.name === keeperName);

        const ticksToSpawn = lair.ticksToSpawn;

        const spawnSoon =
            Number.isFinite(ticksToSpawn) &&
            ticksToSpawn <= this.retreatBeforeSpawnTicks;

        // Хранитель активен или скоро появится —
        // отступаем в сторону домашней комнаты
        if (keeperAlive || spawnSoon) {
            if (!creep.memory.retreating) {
                creep.memory.retreatPosition = null;
                creep.memory.retreating = true;

                console.log(
                    "[БЕШЕНЫЙ ШАХТЁР] Отступление. " +
                    "Хранитель: " +
                    (keeperAlive ? "активен" : "скоро появится") +
                    ", тиков до появления: " +
                    ticksToSpawn
                );
            }

            let retreatPosition = creep.memory.retreatPosition;

            if (!retreatPosition) {
                const exit = this.getHomewardExit(
                    creep,
                    homeRoomName
                );

                if (exit) {
                    const path = creep.pos.findPathTo(exit, {
                        ignoreCreeps: true
                    });

                    // Останавливаемся за две клетки до выхода.
                    const stopIndex = Math.max(0, path.length - 3);
                    const stopPosition = path[stopIndex] || creep.pos;

                    retreatPosition = {
                        x: stopPosition.x,
                        y: stopPosition.y,
                        roomName: stopPosition.roomName
                    };

                    creep.memory.retreatPosition = retreatPosition;
                }
            }

            if (retreatPosition) {
                const position = new RoomPosition(
                    retreatPosition.x,
                    retreatPosition.y,
                    retreatPosition.roomName
                );

                if (!creep.pos.isEqualTo(position)) {
                    creep.moveTo(position, {
                        range: 0,
                        reusePath: 10
                    });
                }
            }

            // На время опасности добычу прекращаем
            return;
        }

        // Хранитель уничтожен, таймер снова безопасен
        if (creep.memory.retreating) {
            creep.memory.retreating = false;
            creep.memory.retreatPosition = null;

            console.log(
                "[БЕШЕНЫЙ ШАХТЁР] Опасность миновала. " +
                "Возвращаемся к источнику."
            );
        }

        // Получаем и сохраняем позицию добычи
        let minePosition = creep.memory.minePosition;

        if (minePosition) {
            const savedPosition = new RoomPosition(
                minePosition.x,
                minePosition.y,
                minePosition.roomName
            );

            const structures = creep.room.lookForAt(
                LOOK_STRUCTURES,
                savedPosition.x,
                savedPosition.y
            );

            const blocked = structures.some(structure =>
                OBSTACLE_OBJECT_TYPES.includes(
                    structure.structureType
                )
            );

            if (
                savedPosition.roomName !== targetRoom ||
                savedPosition.getRangeTo(source) !== 1 ||
                creep.room.getTerrain().get(
                    savedPosition.x,
                    savedPosition.y
                ) === TERRAIN_MASK_WALL ||
                blocked
            ) {
                minePosition = null;
                creep.memory.minePosition = null;
            }
        }

        if (!minePosition) {
            const position = this.findMinePosition(
                creep,
                source
            );

            if (!position) {
                if (Game.time % 25 === 0) {
                    console.log(
                        "[БЕШЕНЫЙ ШАХТЁР] Нет свободной клетки " +
                        "рядом с источником " + source.id
                    );
                }
                return;
            }

            minePosition = {
                x: position.x,
                y: position.y,
                roomName: position.roomName
            };

            creep.memory.minePosition = minePosition;
        }

        const position = new RoomPosition(
            minePosition.x,
            minePosition.y,
            minePosition.roomName
        );

        if (!creep.pos.isEqualTo(position)) {
            creep.moveTo(position, {
                range: 0,
                reusePath: 10
            });
            return;
        }

        // Только добываем — энергия будет падать на землю
        const result = creep.harvest(source);

        if (
            result !== OK &&
            result !== ERR_NOT_ENOUGH_RESOURCES &&
            Game.time % 25 === 0
        ) {
            console.log(
                "[БЕШЕНЫЙ ШАХТЁР] Ошибка добычи: " +
                result + ", источник: " + source.id
            );
        }
    }
};
