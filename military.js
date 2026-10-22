
module.exports = {

    melee: {
        role: "melee",
        desiredCount: 2,
        body: [
            ATTACK, ATTACK, ATTACK, ATTACK, ATTACK,
            ATTACK, ATTACK, ATTACK, ATTACK, ATTACK,
            MOVE, MOVE, MOVE, MOVE
        ]
    },

    ranged: {
        role: "ranged",
        desiredCount: 3,
        body: [
            RANGED_ATTACK, RANGED_ATTACK, RANGED_ATTACK,
            RANGED_ATTACK, RANGED_ATTACK, RANGED_ATTACK,
            MOVE, MOVE, MOVE, MOVE
        ]
    },

    // Тестовые враги для проверки обороны
    // testEnemies: [
    //    { x: 6, y: 1 },
    //    { x: 18, y: 1 },
    //    { x: 30, y: 1 }
    //],

    // Создание бойцов
    manageSpawning: function (spawn) {

        // Проверяем наличие башни в домашней комнате
        const towers = spawn.room.find(FIND_MY_STRUCTURES, {
            filter: structure =>
                structure.structureType === STRUCTURE_TOWER
        });

        // Без башни защитники этой тактики не нужны
        if (towers.length === 0) return;

        // Если спавн занят
        if (spawn.spawning) return;

        const creeps = Object.values(Game.creeps);

        // Сначала создаём ближних бойцов
        const meleeCreeps = creeps.filter(
            creep => creep.memory.role === this.melee.role
        );

        if (meleeCreeps.length < this.melee.desiredCount) {

            const name = "Melee_" + Game.time;

            const result = spawn.spawnCreep(
                this.melee.body,
                name,
                {
                    memory: {
                        role: this.melee.role
                    }
                }
            );

            if (result === OK) {
                console.log(
                    "[ВОЕННЫЙ МОДУЛЬ] Создан боец: " + name
                );
            }

            return;
        }

        // Затем создаём стрелка
        const rangedCreeps = creeps.filter(
            creep => creep.memory.role === this.ranged.role
        );

        if (rangedCreeps.length < this.ranged.desiredCount) {

            const name = "Ranged_" + Game.time;

            const result = spawn.spawnCreep(
                this.ranged.body,
                name,
                {
                    memory: {
                        role: this.ranged.role
                    }
                }
            );

            if (result === OK) {
                console.log(
                    "[ВОЕННЫЙ МОДУЛЬ] Создан стрелок: " + name
                );
            }
        }
    },

    // Поведение ближнего бойца
    runMelee: function (creep, containerId) {
        // Проверяем, находится ли боец в боевом режиме
        if (creep.memory.combatMode) {
            // Пока боевая задача активна, не возвращаемся к контейнеру
        } else {

            const container = Game.getObjectById(containerId);

            // Если контейнер пока не найден
            if (!container) return;

            // Идём к контейнеру
            if (!creep.pos.isNearTo(container)) {
                creep.moveTo(container, {
                    range: 1,
                    reusePath: 20
                });
                return;
            }
        }
        // Боец прибыл и находится в режиме наблюдения
        // Режим наблюдения: ищем врагов возле наших рампартов
        const hostiles = creep.room.find(FIND_HOSTILE_CREEPS);

        const ramparts = creep.room.find(FIND_MY_STRUCTURES, {
            filter: structure =>
                structure.structureType === STRUCTURE_RAMPART
        });

        // Ищем врагов, находящихся рядом с рампартами
        const threats = hostiles.filter(hostile =>
            ramparts.some(rampart =>
                hostile.pos.getRangeTo(rampart) === 1
            )
        );

        // Добавляем виртуальных врагов для тестирования
        //if (creep.room.name === creep.room.name) {
        //    for (const enemy of this.testEnemies) {
        //        const testPosition = new RoomPosition(
        //            enemy.x,
        //            enemy.y,
        //            creep.room.name
        //        );

        // Добавляем только цели рядом с рампартами
        //        if (ramparts.some(rampart =>
        //            testPosition.getRangeTo(rampart) === 1
        //        )) {
        //            threats.push({
        //                name: `TEST_ENEMY_${enemy.x}_${enemy.y}`,
        //                pos: testPosition,
        //                isTest: true
        //            });
        //        }
        //    }
        //}

        // Проверяем врагов по очереди
        let threat = null;
        let targetRampart = null;

        for (const hostile of threats) {
            const combatPositions = ramparts.filter(rampart => {

                // Рампарт должен находиться рядом с врагом
                if (hostile.pos.getRangeTo(rampart) !== 1) {
                    return false;
                }

                // Не занимаем рампарт, зарезервированный другим бойцом
                const reservedByOther = Object.values(Game.creeps).some(other =>
                    other.name !== creep.name &&
                    other.memory.role === this.melee.role &&
                    other.memory.combatRampartId === rampart.id
                );

                if (reservedByOther) return false;

                // На клетке не должно быть другого крипа
                const creepsOnPosition = rampart.pos.lookFor(LOOK_CREEPS);

                if (creepsOnPosition.some(other => other.id !== creep.id)) {
                    return false;
                }

                // Проверяем непроходимые сооружения
                const structures = rampart.pos.lookFor(LOOK_STRUCTURES);

                const blocked = structures.some(structure =>
                    structure.id !== rampart.id &&
                    structure.structureType !== STRUCTURE_ROAD &&
                    structure.structureType !== STRUCTURE_CONTAINER &&
                    structure.structureType !== STRUCTURE_RAMPART
                );

                return !blocked;
            });

            // Если для врага есть свободный рампарт, выбираем его
            if (combatPositions.length > 0) {
                threat = hostile;
                targetRampart = creep.pos.findClosestByRange(
                    combatPositions
                );
                break;
            }
        }

        // Если для врагов нет свободных позиций, ждём
        if (!threat || !targetRampart) {
            delete creep.memory.combatRampartId;
            return;
        }

        // Переходим в боевой режим
        creep.memory.combatMode = true;

        // Сообщаем о выбранной цели
        console.log(
            "[ВОЕННЫЙ МОДУЛЬ] " + creep.name +
            " выбрал цель: " + threat.name
        );

        // Закрепляем рампарт за бойцом
        creep.memory.combatRampartId = targetRampart.id;

        // Двигаемся на выбранный рампарт
        if (!creep.pos.isEqualTo(targetRampart.pos)) {
            creep.moveTo(targetRampart, {
                reusePath: 10
            });
            return;
        }

        // Тестовая цель: проверяем занятие позиции
        //if (threat.isTest) {
        //    console.log(
        //        "[ТЕСТ ОБОРОНЫ] " + creep.name +
        //        " занял позицию для атаки тестовой цели"
        //    );
        //    return;
        //}

        // Настоящий враг: атакуем
        const result = creep.attack(threat);

        if (result === ERR_NOT_IN_RANGE) {
            creep.moveTo(threat, {
                reusePath: 5
            });
        }
    },

    // Поведение стрелка
    runRanged: function (creep, containerId) {

        // Первоначальное перемещение на боевой пост
        if (!creep.memory.rangedPostReached) {


            const container = Game.getObjectById(containerId);

            // Если контейнер не найден, ждём
            if (!container) return;

            // Идём к боевому посту
            if (!creep.pos.isNearTo(container)) {
                creep.moveTo(container, {
                    range: 1,
                    reusePath: 20
                });
                return;
            }

            // Боевая позиция достигнута
            creep.memory.rangedPostReached = true;

            console.log(
                "[ВОЕННЫЙ МОДУЛЬ] " + creep.name +
                " занял боевой пост стрелка"
            );
        }

        // Ищем врагов и наши рампарты
        const hostiles = creep.room.find(FIND_HOSTILE_CREEPS);

        const ramparts = creep.room.find(FIND_MY_STRUCTURES, {
            filter: structure =>
                structure.structureType === STRUCTURE_RAMPART
        });

        // Обнаруживаем врагов в одной клетке от рампартов
        const threats = hostiles.filter(hostile =>
            ramparts.some(rampart =>
                hostile.pos.getRangeTo(rampart) === 1
            )
        );

        // Если угроз нет, ждём
        if (threats.length === 0) {
            delete creep.memory.rangedPosition;
            delete creep.memory.rangedTargetId;
            return;
        }

        const allCreeps = Object.values(Game.creeps);

        let target = null;
        let targetPosition = null;
        let bestRange = Infinity;

        // Проверяем врагов по очереди
        for (const hostile of threats) {

            // Ищем рампарт рядом с врагом
            for (const rampart of ramparts) {

                const dx = hostile.pos.x - rampart.pos.x;
                const dy = hostile.pos.y - rampart.pos.y;

                // Пока обрабатываем только четыре стороны.
                // Диагональные позиции не учитываем.
                if (Math.abs(dx) + Math.abs(dy) !== 1) {
                    continue;
                }

                // Определяем три позиции с внутренней стороны рампарта
                let positions = [];

                if (dx === 0 && dy === -1) {
                    // Враг сверху — стрелок располагается снизу
                    positions = [
                        [rampart.pos.x - 1, rampart.pos.y + 2],
                        [rampart.pos.x, rampart.pos.y + 2],
                        [rampart.pos.x + 1, rampart.pos.y + 2]
                    ];

                } else if (dx === 0 && dy === 1) {
                    // Враг снизу — стрелок располагается сверху
                    positions = [
                        [rampart.pos.x - 1, rampart.pos.y - 2],
                        [rampart.pos.x, rampart.pos.y - 2],
                        [rampart.pos.x + 1, rampart.pos.y - 2]
                    ];

                } else if (dx === -1 && dy === 0) {
                    // Враг слева — стрелок располагается справа
                    positions = [
                        [rampart.pos.x + 2, rampart.pos.y - 1],
                        [rampart.pos.x + 2, rampart.pos.y],
                        [rampart.pos.x + 2, rampart.pos.y + 1]
                    ];

                } else if (dx === 1 && dy === 0) {
                    // Враг справа — стрелок располагается слева
                    positions = [
                        [rampart.pos.x - 2, rampart.pos.y - 1],
                        [rampart.pos.x - 2, rampart.pos.y],
                        [rampart.pos.x - 2, rampart.pos.y + 1]
                    ];
                }

                // Проверяем доступность каждой позиции
                for (const [x, y] of positions) {

                    // Позиция должна оставаться внутри комнаты
                    if (x < 1 || x > 48 || y < 1 || y > 48) {
                        continue;
                    }

                    const pos = new RoomPosition(
                        x,
                        y,
                        creep.room.name
                    );

                    // Атака должна доставать до цели
                    if (pos.getRangeTo(hostile) > 3) {
                        continue;
                    }

                    // Не занимаем клетку, занятую другим крипом
                    const occupied = allCreeps.some(other =>
                        other.id !== creep.id &&
                        other.pos.roomName === creep.room.name &&
                        other.pos.x === x &&
                        other.pos.y === y
                    );

                    if (occupied) continue;

                    // Проверяем проходимость клетки
                    const terrain = creep.room.getTerrain().get(x, y);

                    if (terrain === TERRAIN_MASK_WALL) continue;

                    const structures = pos.lookFor(LOOK_STRUCTURES);

                    const blocked = structures.some(structure =>
                        structure.structureType !== STRUCTURE_ROAD &&
                        structure.structureType !== STRUCTURE_CONTAINER &&
                        structure.structureType !== STRUCTURE_RAMPART
                    );

                    if (blocked) continue;

                    // Выбираем ближайшую доступную позицию
                    const range = creep.pos.getRangeTo(pos);

                    if (range < bestRange) {
                        bestRange = range;
                        target = hostile;
                        targetPosition = pos;
                    }
                }
            }

            // Если для этого врага найдена подходящая позиция,
            // переходим к нему, не перебирая следующих врагов
            if (target) break;
        }

        // Подходящих позиций нет — ждём
        if (!target || !targetPosition) {
            delete creep.memory.rangedPosition;
            delete creep.memory.rangedTargetId;
            return;
        }

        // Запоминаем цель и выбранную позицию
        creep.memory.rangedTargetId = target.id;
        creep.memory.rangedPosition = {
            x: targetPosition.x,
            y: targetPosition.y
        };

        // Идём на боевую позицию
        if (!creep.pos.isEqualTo(targetPosition)) {
            creep.moveTo(targetPosition, {
                reusePath: 5
            });
            return;
        }

        // Атакуем, если цель всё ещё существует и доступна
        const currentTarget = Game.getObjectById(
            creep.memory.rangedTargetId
        );

        if (currentTarget &&
            creep.pos.getRangeTo(currentTarget) <= 3) {

            creep.rangedAttack(currentTarget);
        }
    }

};
