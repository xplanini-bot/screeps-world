
module.exports = {

    role: "berserkMiner",
    desiredCount: 1,

    targetRoom: "",

    // Отступаем за 20 тиков до появления хранителя E26N55
    retreatBeforeSpawnTicks: 20,

    // Тело: 6 WORK + 6 MOVE
    body: [
        WORK, WORK, WORK,
        WORK, WORK, WORK,

        MOVE, MOVE, MOVE,
        MOVE, MOVE, MOVE
    ],

    // Роль и количество перевозчиков
    carrierRole: "berserkCarrier",
    carrierDesiredCount: 1,

    // Тело перевозчика: 10 CARRY + 10 MOVE
    carrierBody: [
        CARRY, CARRY, CARRY, CARRY, CARRY,
        CARRY, CARRY, CARRY, CARRY, CARRY,

        MOVE, MOVE, MOVE, MOVE, MOVE,
        MOVE, MOVE, MOVE, MOVE, MOVE
    ],

    // Создание шахтёра и следующего за ним перевозчика
    manageSpawning: function (spawn) {
        if (!this.targetRoom || spawn.spawning) return;

        const squadId = "attackerSquad_" + this.targetRoom;

        const squadState =
            Memory.attackerSquads &&
            Memory.attackerSquads[squadId];

        // Ждём, пока боевой отряд определит логово
        if (!squadState || !squadState.keeperLairId) {
            return;
        }

        const creeps = Object.values(Game.creeps);

        const miner = creeps.find(creep =>
            creep.memory.role === this.role &&
            creep.memory.targetRoom === this.targetRoom &&
            creep.memory.squadId === squadId
        );

        // Этап 1: создаём шахтёра
        if (!miner) {
            const cost = this.body.reduce(
                (total, part) => total + BODYPART_COST[part],
                0
            );

            if (spawn.room.energyAvailable < cost) return;

            const name = "BerserkMiner_" + Game.time;

            const result = spawn.spawnCreep(
                this.body,
                name,
                {
                    memory: {
                        role: this.role,
                        targetRoom: this.targetRoom,
                        homeRoomName: spawn.room.name,
                        squadId: squadId,
                        keeperLairId: squadState.keeperLairId,
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
        // и при наличии домашнего Storage
        if (!spawn.room.storage) return;

        const carrierExists = creeps.some(creep =>
            creep.memory.role === this.carrierRole &&
            creep.memory.squadId === squadId
        );

        if (carrierExists) return;

        const cost = this.carrierBody.reduce(
            (total, part) => total + BODYPART_COST[part],
            0
        );

        if (spawn.room.energyAvailable < cost) return;

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

        const lair = Game.getObjectById(
            creep.memory.keeperLairId
        );

        // Без известного логова шахтёр не начинает добычу
        if (
            !lair ||
            lair.structureType !== STRUCTURE_KEEPER_LAIR
        ) {
            if (Game.time % 25 === 0) {
                console.log(
                    "[БЕШЕНЫЙ ШАХТЁР] Не найдено логово: " +
                    creep.memory.keeperLairId
                );
            }
            return;
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
                    retreatPosition = {
                        x: exit.x,
                        y: exit.y,
                        roomName: exit.roomName
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
