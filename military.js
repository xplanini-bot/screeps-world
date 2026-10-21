
module.exports = {

    melee: {
        role: "melee",
        desiredCount: 1,
        body: [
            ATTACK, ATTACK, ATTACK, ATTACK, ATTACK,
            ATTACK, ATTACK, ATTACK, ATTACK, ATTACK,
            MOVE, MOVE, MOVE, MOVE
        ]
    },
    // Тестовый противник для проверки обороны
    //testEnemy: {
    //    enabled: true,
    //    roomName: "W23S31",
    //    x: 10,
    //    y: 1
    //},

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

        // Ищем настоящего врага возле рампартов
        let threat = hostiles.find(hostile =>
            ramparts.some(rampart =>
                hostile.pos.getRangeTo(rampart) <= 1
            )
        );

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

        // Если угрозы нет, продолжаем наблюдение
        if (!threat) return;

        // Переходим в боевой режим
        creep.memory.combatMode = true;

        // Обнаружена угроза
        console.log(
            "[ВОЕННЫЙ МОДУЛЬ] " + creep.name +
            " обнаружил цель: " + threat.name
        );


        // Ищем доступные рампарты для ближней атаки
        const combatPositions = ramparts.filter(rampart => {

            // Рампарт должен находиться рядом с врагом
            if (threat.pos.getRangeTo(rampart) !== 1) {
                return false;
            }

            // На клетке не должно быть другого крипа
            const creepsOnPosition = rampart.pos.lookFor(LOOK_CREEPS);

            if (creepsOnPosition.some(other => other.id !== creep.id)) {
                return false;
            }

            // Проверяем, что клетка не занята непроходимым сооружением
            const structures = rampart.pos.lookFor(LOOK_STRUCTURES);

            const blocked = structures.some(structure =>
                structure.id !== rampart.id &&
                structure.structureType !== STRUCTURE_ROAD &&
                structure.structureType !== STRUCTURE_CONTAINER &&
                structure.structureType !== STRUCTURE_RAMPART
            );

            if (blocked) return false;

            // Клетка подходит
            return true;
        });

        // Если свободных боевых позиций нет, ждём
        if (combatPositions.length === 0) return;

        // Выбираем ближайший рампарт
        const targetRampart = creep.pos.findClosestByRange(
            combatPositions
        );

        // Если позиция не найдена, ждём
        if (!targetRampart) return;
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
    }

};
