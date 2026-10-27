// Проверка: является ли крип Source Keeper
function isSourceKeeper(creep) {
    return !!creep &&
        !!creep.owner &&
        creep.owner.username === "Source Keeper";
}

// Получение всех Source Keeper в комнате
function getSourceKeepers(room) {
    return room.find(FIND_HOSTILE_CREEPS).filter(
        creep => isSourceKeeper(creep)
    );
}

// Поиск ближайшего свободного источника энергии
function findFreeMine(creep) {
    const room = creep.room;

    // Источники, уже закреплённые за другими боевыми шахтёрами
    const assignedMineIds = new Set(
        Object.values(Game.creeps)
            .filter(other =>
                other.name !== creep.name &&
                other.memory.role === "combatMiner" &&
                other.memory.mineRoomName === room.name &&
                other.memory.mineId
            )
            .map(other => other.memory.mineId)
    );

    const sources = room.find(FIND_SOURCES).filter(source => {

        // Источник должен содержать энергию
        if (source.energy <= 0) return false;

        // Источник не должен быть закреплён за другим шахтёром
        if (assignedMineIds.has(source.id)) return false;

        // Источник считается занятым, если возле него уже есть
        // наш построенный рампарт
        const nearbyRamparts = source.pos.findInRange(
            FIND_MY_STRUCTURES,
            1,
            {
                filter: structure =>
                    structure.structureType === STRUCTURE_RAMPART
            }
        );

        if (nearbyRamparts.length > 0) return false;

        return true;
    });

    // Сначала рассматриваем ближайшую свободную шахту
    sources.sort((a, b) =>
        creep.pos.getRangeTo(a) - creep.pos.getRangeTo(b)
    );

    return sources[0] || null;
}


module.exports = {

    role: "combatMiner",
    desiredCount: 1,

    // За сколько тиков до смерти создавать сменщика
    replacementLeadTime: 200,

    // Целевая комната
    // Пустая строка отключает создание юнита
    targetRoom: "E26N55",

    // Тело боевого шахтёра
    // Стоимость: 1290 энергии
    body: [
        WORK, WORK, WORK, WORK, WORK, WORK,

        CARRY,

        RANGED_ATTACK,

        ATTACK, ATTACK, ATTACK,

        MOVE, MOVE, MOVE, MOVE, MOVE
    ],

    // Создание боевого шахтёра и предварительного сменщика
    manageSpawning: function (spawn) {

        // Без целевой комнаты юнит не нужен
        if (!this.targetRoom) return false;

        // Если спавн занят, ждём
        if (spawn.spawning) return false;

        if (!Memory.combatMinerAssignments) {
            Memory.combatMinerAssignments = {};
        }

        const assignments = Memory.combatMinerAssignments;

        // Находим всех боевых шахтёров для целевой комнаты
        const miners = Object.values(Game.creeps).filter(
            creep =>
                creep.memory.role === this.role &&
                creep.memory.targetRoom === this.targetRoom
        );

        // Различаем действующего шахтёра и его сменщика
        let currentMiner = miners.find(
            creep => !creep.memory.isReplacement
        );

        let replacementMiner = miners.find(
            creep => creep.memory.isReplacement
        );

        // Ищем сохранённое назначение шахты.
        // Поддерживаем и прежнюю запись, ключом которой была комната.
        const getAssignment = miner => {
            if (miner && miner.memory.mineId) {
                return assignments[miner.memory.mineId] ||
                    assignments[this.targetRoom] ||
                    null;
            }

            return assignments[this.targetRoom] || null;
        };

        // Если старый шахтёр погиб, передаём его назначение сменщику
        if (!currentMiner && replacementMiner) {

            replacementMiner.memory.isReplacement = false;
            delete replacementMiner.memory.replacementFor;

            currentMiner = replacementMiner;
            replacementMiner = null;

            const assignment = getAssignment(currentMiner);

            if (assignment) {
                assignment.currentMinerName = currentMiner.name;
                assignment.replacementMinerName = null;
            }

            console.log(
                "[БОЕВОЙ ШАХТЁР] Сменщик принимает шахту: " +
                currentMiner.name
            );
        }

        // Если действующий шахтёр и сменщик уже существуют,
        // больше никого не создаём
        if (currentMiner && replacementMiner) {
            return false;
        }

        // Выбираем тело и проверяем стоимость
        const cost = this.body.reduce(
            (total, part) => total + BODYPART_COST[part],
            0
        );

        if (spawn.room.energyAvailable < cost) return false;

        // Если действующий шахтёр существует,
        // проверяем, пора ли создавать сменщика
        if (currentMiner) {

            if (
                currentMiner.spawning ||
                currentMiner.ticksToLive === undefined ||
                currentMiner.ticksToLive > this.replacementLeadTime
            ) {
                return false;
            }

            // Сменщик должен получить назначение той же шахты
            const mineId = currentMiner.memory.mineId;

            // Пока шахта не назначена, не создаём сменщика
            if (!mineId) return false;

            const assignment = getAssignment(currentMiner);

            const name = "CombatMiner_" + Game.time;

            const memory = {
                role: this.role,
                targetRoom: this.targetRoom,
                homeRoomName:
                    currentMiner.memory.homeRoomName || spawn.room.name,
                mineId: mineId,
                mineRoomName:
                    currentMiner.memory.mineRoomName || this.targetRoom,
                isReplacement: true,
                replacementFor: currentMiner.name
            };

            // Передаём сменщику зафиксированную клетку добычи
            const minePosition =
                (assignment && assignment.minePosition) ||
                currentMiner.memory.minePosition;

            if (minePosition) {
                memory.minePosition = {
                    x: minePosition.x,
                    y: minePosition.y,
                    roomName: minePosition.roomName
                };
            }

            const result = spawn.spawnCreep(
                this.body,
                name,
                { memory: memory }
            );

            if (result === OK) {

                // Назначение сохраняется независимо от жизни крипа
                const savedAssignment = assignment ||
                    (assignments[mineId] = {
                        mineId: mineId,
                        mineRoomName: memory.mineRoomName,
                        targetRoom: this.targetRoom,
                        minePosition: minePosition || null
                    });

                savedAssignment.currentMinerName = currentMiner.name;
                savedAssignment.replacementMinerName = name;

                console.log(
                    "[БОЕВОЙ ШАХТЁР] Создан сменщик: " + name +
                    ", заменяет: " + currentMiner.name +
                    ", шахта: " + mineId
                );
            }

            return result === OK;
        }

        // Действующего шахтёра нет.
        // Создаём нового, при возможности восстанавливая прошлое назначение.
        let previousAssignment = assignments[this.targetRoom] || null;

        if (!previousAssignment) {
            previousAssignment = Object.values(assignments).find(
                assignment =>
                    assignment &&
                    assignment.targetRoom === this.targetRoom
            ) || null;
        }

        const name = "CombatMiner_" + Game.time;

        const memory = {
            role: this.role,
            targetRoom: this.targetRoom,
            homeRoomName: spawn.room.name,
            isReplacement: false
        };

        if (previousAssignment && previousAssignment.mineId) {
            memory.mineId = previousAssignment.mineId;
            memory.mineRoomName =
                previousAssignment.mineRoomName || this.targetRoom;

            if (previousAssignment.minePosition) {
                memory.minePosition = {
                    x: previousAssignment.minePosition.x,
                    y: previousAssignment.minePosition.y,
                    roomName: previousAssignment.minePosition.roomName
                };
            }
        }

        const result = spawn.spawnCreep(
            this.body,
            name,
            { memory: memory }
        );

        if (result === OK) {

            if (previousAssignment) {
                previousAssignment.currentMinerName = name;
                previousAssignment.replacementMinerName = null;
            }

            console.log(
                "[БОЕВОЙ ШАХТЁР] Создан основной юнит: " + name +
                ", цель: " + this.targetRoom
            );
        }

        return result === OK;
    },

    // Поведение боевого шахтёра
    run: function (creep) {

        if (creep.spawning) return;

        const targetRoom = creep.memory.targetRoom || this.targetRoom;

        // Без целевой комнаты ничего не делаем
        if (!targetRoom) return;

        // Поведение предварительного сменщика
        if (creep.memory.isReplacement) {

            const currentMiner = Game.creeps[
                creep.memory.replacementFor
            ];

            // Основной шахтёр ещё жив:
            // сменщик заранее направляется к той же шахте
            if (currentMiner) {

                // Сначала добираемся до целевой комнаты
                if (creep.room.name !== targetRoom) {
                    creep.moveTo(
                        new RoomPosition(25, 25, targetRoom),
                        {
                            reusePath: 25
                        }
                    );

                    return;
                }

                // Получаем сохранённую клетку добычи
                const assignments =
                    Memory.combatMinerAssignments || {};

                const assignment = creep.memory.mineId
                    ? assignments[creep.memory.mineId]
                    : null;

                const savedPosition =
                    creep.memory.minePosition ||
                    (assignment && assignment.minePosition);

                // Подходим к клетке добычи, но не занимаем её
                // до смерти действующего шахтёра
                if (savedPosition) {

                    const position = new RoomPosition(
                        savedPosition.x,
                        savedPosition.y,
                        savedPosition.roomName
                    );

                    if (
                        creep.pos.roomName !== position.roomName ||
                        creep.pos.getRangeTo(position) > 1
                    ) {
                        creep.moveTo(position, {
                            range: 1,
                            reusePath: 5
                        });
                    }
                }

                // Ждём, не добывая и не ремонтируя
                return;
            }

            // Основной шахтёр погиб — сменщик принимает шахту
            if (!Memory.combatMinerAssignments) {
                Memory.combatMinerAssignments = {};
            }

            const assignments = Memory.combatMinerAssignments;
            const mineId = creep.memory.mineId;

            const assignment = mineId
                ? assignments[mineId]
                : null;

            if (assignment) {
                assignment.currentMinerName = creep.name;
                assignment.replacementMinerName = null;
            }

            delete creep.memory.isReplacement;
            delete creep.memory.replacementFor;

            console.log(
                "[БОЕВОЙ ШАХТЁР] Сменщик принимает шахту: " +
                creep.name
            );
        }

        // Идём в целевую комнату
        if (creep.room.name !== targetRoom) {
            creep.moveTo(
                new RoomPosition(25, 25, targetRoom),
                {
                    reusePath: 25
                }
            );

            return;
        }

        const room = creep.room;

        // Сохраняем назначения отдельно от памяти крипов
        if (!Memory.combatMinerAssignments) {
            Memory.combatMinerAssignments = {};
        }

        const assignments = Memory.combatMinerAssignments;

        // Поддерживаем старый формат, где ключом была комната
        const legacyAssignment = assignments[targetRoom] || null;

        // Сначала ищем шахту, сохранённую в памяти крипа
        let mine = creep.memory.mineId
            ? Game.getObjectById(creep.memory.mineId)
            : null;

        let assignment = mine
            ? assignments[mine.id] || null
            : null;

        // Переносим старую запись на ключ ID источника
        if (
            !assignment &&
            legacyAssignment &&
            legacyAssignment.mineId &&
            (!mine || legacyAssignment.mineId === mine.id)
        ) {
            const savedMine = Game.getObjectById(
                legacyAssignment.mineId
            );

            if (savedMine && savedMine.room.name === room.name) {
                mine = savedMine;
                assignment = legacyAssignment;

                assignments[mine.id] = assignment;
                delete assignments[targetRoom];
            }
        }

        // Если назначение не удалось восстановить,
        // выбираем свободную шахту
        if (!mine) {
            mine = findFreeMine(creep);

            if (!mine) {
                if (Game.time % 25 === 0) {
                    console.log(
                        `[БОЕВОЙ ШАХТЁР] ${creep.name}: ` +
                        `свободная шахта не найдена в ${room.name}`
                    );
                }

                return;
            }
        }

        // Закрепляем источник за шахтёром
        creep.memory.mineId = mine.id;
        creep.memory.mineRoomName = mine.room.name;

        // Создаём постоянную запись по ID шахты
        if (!assignment || assignment.mineId !== mine.id) {
            assignment = {
                mineId: mine.id,
                mineRoomName: mine.room.name,
                targetRoom: targetRoom,
                currentMinerName: creep.memory.isReplacement
                    ? null
                    : creep.name,
                replacementMinerName: creep.memory.isReplacement
                    ? creep.name
                    : null,
                minePosition: creep.memory.minePosition || null
            };

            assignments[mine.id] = assignment;
        }

        assignment.targetRoom = targetRoom;
        assignment.mineRoomName = mine.room.name;

        // Обновляем владельца назначения
        if (creep.memory.isReplacement) {
            assignment.replacementMinerName = creep.name;
        } else {
            assignment.currentMinerName = creep.name;
        }

        // Восстанавливаем сохранённую клетку добычи
        if (assignment.minePosition) {
            creep.memory.minePosition = {
                x: assignment.minePosition.x,
                y: assignment.minePosition.y,
                roomName: assignment.minePosition.roomName
            };
        } else if (creep.memory.minePosition) {
            assignment.minePosition = {
                x: creep.memory.minePosition.x,
                y: creep.memory.minePosition.y,
                roomName: creep.memory.minePosition.roomName
            };
        }

        // Если шахта ещё не освоена и рампарта нет,
        // запоминаем ближайшего Source Keeper
        const nearbyRamparts = mine.pos.findInRange(
            FIND_MY_STRUCTURES,
            1,
            {
                filter: structure =>
                    structure.structureType === STRUCTURE_RAMPART
            }
        );

        if (
            !creep.memory.minePosition &&
            nearbyRamparts.length === 0 &&
            !creep.memory.sourceKeeperId
        ) {
            const keepers = getSourceKeepers(room);

            keepers.sort((a, b) =>
                a.pos.getRangeTo(mine) -
                b.pos.getRangeTo(mine)
            );

            const keeper = keepers[0];

            if (keeper) {
                creep.memory.sourceKeeperId = keeper.id;
                creep.memory.sourceKeeperTTL = keeper.ticksToLive;
            }
        }
        // Если защитник был выбран, ждём его смерти
        if (creep.memory.sourceKeeperId) {
            const keeper = Game.getObjectById(
                creep.memory.sourceKeeperId
            );

            if (keeper && isSourceKeeper(keeper)) {
                creep.memory.sourceKeeperTTL = keeper.ticksToLive;

                if (Game.time % 25 === 0) {
                    console.log(
                        `[БОЕВОЙ ШАХТЁР] ${creep.name}: ` +
                        `ожидаем гибели Source Keeper, ` +
                        `осталось тиков: ${keeper.ticksToLive}`
                    );
                }

                return;
            }

            // Выбранный защитник исчез — можно идти к шахте
            console.log(
                `[БОЕВОЙ ШАХТЁР] ${creep.name}: ` +
                `Source Keeper исчез, направляемся к шахте`
            );

            delete creep.memory.sourceKeeperId;
            delete creep.memory.sourceKeeperTTL;
        }

        // Если клетка добычи уже сохранена, работаем только на ней
        const savedPosition = creep.memory.minePosition;

        if (savedPosition) {

            const position = new RoomPosition(
                savedPosition.x,
                savedPosition.y,
                savedPosition.roomName
            );

            // Если шахтёр оказался не на своей клетке,
            // возвращаемся на неё и не выполняем другие действия
            if (!creep.pos.isEqualTo(position)) {
                creep.moveTo(position, {
                    range: 0,
                    reusePath: 5
                });

                return;
            }

            // Ищем рампарт на закреплённой клетке
            const structuresAtPosition = room.lookForAt(
                LOOK_STRUCTURES,
                savedPosition.x,
                savedPosition.y
            );

            const rampart = structuresAtPosition.find(
                structure =>
                    structure.structureType === STRUCTURE_RAMPART &&
                    structure.my
            );

            // Проверяем строительную площадку рампарта
            const sitesAtPosition = room.lookForAt(
                LOOK_CONSTRUCTION_SITES,
                savedPosition.x,
                savedPosition.y
            );

            const rampartSite = sitesAtPosition.find(
                site =>
                    site.structureType === STRUCTURE_RAMPART &&
                    site.my
            );

            // Если рампарта ещё нет, создаём его площадку
            if (!rampart && !rampartSite) {

                const result = room.createConstructionSite(
                    savedPosition.x,
                    savedPosition.y,
                    STRUCTURE_RAMPART
                );

                if (result === OK) {
                    console.log(
                        `[БОЕВОЙ ШАХТЁР] ${creep.name}: создана площадка рампарта ` +
                        `на (${savedPosition.x}, ${savedPosition.y})`
                    );
                } else if (Game.time % 25 === 0) {
                    console.log(
                        `[БОЕВОЙ ШАХТЁР] ${creep.name}: не удалось создать рампарт, ` +
                        `код ошибки: ${result}`
                    );
                }

                // Если энергии нет, добываем её на своей клетке
                if (creep.store[RESOURCE_ENERGY] === 0) {
                    creep.harvest(mine);
                }

                return;
            }

            // Пока рампарт строится, используем энергию на строительство
            if (rampartSite) {

                if (creep.store[RESOURCE_ENERGY] > 0) {
                    creep.build(rampartSite);
                } else {
                    creep.harvest(mine);
                }

                return;
            }

            // Рампарт построен: атакуем Source Keeper,
            // если он находится в радиусе дальней атаки
            if (rampart) {

                // Ищем Source Keeper в пределах 3 клеток
                const nearbyKeepers = getSourceKeepers(room).filter(
                    keeper => creep.pos.getRangeTo(keeper) <= 3
                );

                // Выбираем ближайшего доступного защитника
                const target = creep.pos.findClosestByRange(nearbyKeepers);

                if (target) {

                    const distance = creep.pos.getRangeTo(target);

                    // Дальняя атака
                    creep.rangedAttack(target);

                    // Если защитник вплотную, дополнительно используем ближнюю атаку
                    if (distance <= 1) {
                        creep.attack(target);
                    }

                    // Не преследуем цель и не покидаем клетку рампарта
                    return;
                }

                // В радиусе атаки врагов нет — продолжаем обычную работу
                if (
                    creep.store[RESOURCE_ENERGY] > 0 &&
                    rampart.hits < rampart.hitsMax
                ) {
                    creep.repair(rampart);
                } else {
                    creep.harvest(mine);
                }

                return;
            }

        }

        // Идём к источнику: moveTo сам выбирает путь и соседнюю клетку
        if (creep.pos.getRangeTo(mine) > 1) {
            creep.moveTo(mine, {
                range: 1,
                reusePath: 10
            });

            return;
        }

        // Начинаем добычу
        const result = creep.harvest(mine);

        // После успешной добычи закрепляем клетку
        if (result === OK) {
            const position = {
                x: creep.pos.x,
                y: creep.pos.y,
                roomName: creep.room.name
            };

            // Запись крипа
            creep.memory.minePosition = position;

            // Постоянная запись, которая переживёт его смерть
            if (!Memory.combatMinerAssignments) {
                Memory.combatMinerAssignments = {};
            }

            const assignments = Memory.combatMinerAssignments;
            let assignment = assignments[mine.id];

            if (!assignment) {
                assignment = {
                    mineId: mine.id,
                    mineRoomName: mine.room.name,
                    targetRoom: targetRoom,
                    currentMinerName: creep.memory.isReplacement
                        ? null
                        : creep.name,
                    replacementMinerName: creep.memory.isReplacement
                        ? creep.name
                        : null,
                    minePosition: position
                };

                assignments[mine.id] = assignment;
            }

            assignment.mineId = mine.id;
            assignment.mineRoomName = mine.room.name;
            assignment.targetRoom = targetRoom;
            assignment.minePosition = position;

            if (creep.memory.isReplacement) {
                assignment.replacementMinerName = creep.name;
            } else {
                assignment.currentMinerName = creep.name;
            }

            console.log(
                `[БОЕВОЙ ШАХТЁР] ${creep.name}: закреплена клетка добычи ` +
                `${position.x},${position.y} в ${position.roomName}`
            );
        }
    }
};