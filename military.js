
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
    // Тестовые враги для проверки обороны
    testEnemies: [
    //    { x: 10, y: 1 },
    //    { x: 20, y: 1 },
    //    { x: 30, y: 1 }
    ],

    // Создание ближних бойцов
    manageSpawning: function (spawn) {

        // Проверяем наличие башни в домашней комнате
        const towers = spawn.room.find(FIND_MY_STRUCTURES, {
            filter: structure => structure.structureType === STRUCTURE_TOWER
        });

        // Без башни защитники этой тактики не нужны
        if (towers.length === 0) return;

        // Если спавн занят экономическим или другим крипом
        if (spawn.spawning) return;

        // Считаем уже существующих ближних бойцов
        const meleeCreeps = Object.values(Game.creeps).filter(
            creep => creep.memory.role === this.melee.role
        );

        // Если нужное количество уже создано
        if (meleeCreeps.length >= this.melee.desiredCount) return;

        // Имя нового бойца
        const name = "Melee_" + Game.time;

        // Создаём бойца
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
            console.log("[ВОЕННЫЙ МОДУЛЬ] Создан боец: " + name);
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
        if (creep.room.name === creep.room.name) {
            for (const enemy of this.testEnemies) {
                const testPosition = new RoomPosition(
                    enemy.x,
                    enemy.y,
                    creep.room.name
                );

                // Добавляем только цели рядом с рампартами
                if (ramparts.some(rampart =>
                    testPosition.getRangeTo(rampart) === 1
                )) {
                    threats.push({
                        name: `TEST_ENEMY_${enemy.x}_${enemy.y}`,
                        pos: testPosition,
                        isTest: true
                    });
                }
            }
        }

        // Если настоящего врага нет, проверяем тестовую цель
        //if (
        //    !threat &&
        //    this.testEnemy.enabled &&
        //    creep.room.name === this.testEnemy.roomName
        //) {
        //    const testPosition = new RoomPosition(
        //        this.testEnemy.x,
        //        this.testEnemy.y,
        //        this.testEnemy.roomName
        //    );

        //    const nearRampart = ramparts.some(rampart =>
        //        testPosition.getRangeTo(rampart) <= 1
        //    );

        //    if (nearRampart) {
        //        threat = {
        //            name: "TEST_ENEMY",
        //            pos: testPosition,
        //            isTest: true
        //        };
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
        if (threat.isTest) {
            console.log(
                "[ТЕСТ ОБОРОНЫ] " + creep.name +
                " занял позицию для атаки тестовой цели"
            );
            return;
        }

        // Настоящий враг: атакуем
        const result = creep.attack(threat);

        if (result === ERR_NOT_IN_RANGE) {
            creep.moveTo(threat, {
                reusePath: 5
            });
        }
    }

};
