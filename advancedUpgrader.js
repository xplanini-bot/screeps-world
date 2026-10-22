
const advancedUpgrader = {
    role: "advancedUpgrader",
    desiredCount: 1,

    body: [
        WORK, WORK, WORK, WORK, WORK,
        WORK, WORK, WORK, WORK, WORK,
        CARRY,
        MOVE, MOVE
    ],

    // Поиск контейнера рядом с контроллером
    findControllerContainer(room) {
        const controller = room.controller;
        if (!controller) return null;

        return room.find(FIND_STRUCTURES, {
            filter: structure =>
                structure.structureType === STRUCTURE_CONTAINER &&
                structure.pos.getRangeTo(controller) <= 1
        })[0] || null;
    },

    
manageSpawning(spawn) {
    if (spawn.spawning) {
        return;
    }

    const room = spawn.room;

    if (!room.storage) {
        console.log("[AdvancedUpgrader] Нет построенного Storage");
        return;
    }

    const extensions = room.find(FIND_MY_STRUCTURES, {
        filter: structure =>
            structure.structureType === STRUCTURE_EXTENSION
    });

    if (extensions.length < 17) {
        console.log(
            `[AdvancedUpgrader] Расширителей: ${extensions.length}/17`
        );
        return;
    }

    const container = this.findControllerContainer(room);

    if (!container) {
        console.log(
            "[AdvancedUpgrader] Не найден контейнер возле контроллера"
        );
        return;
    }

    const creeps = Object.values(Game.creeps).filter(
        creep => creep.memory.role === this.role
    );

    if (creeps.length >= this.desiredCount) {
        console.log(
            `[AdvancedUpgrader] Уже существует юнитов: ${creeps.length}`
        );
        return;
    }

    const cost = this.body.reduce(
        (total, part) => total + BODYPART_COST[part],
        0
    );

    if (room.energyAvailable < cost) {
        console.log(
            `[AdvancedUpgrader] Энергии ${room.energyAvailable}/${cost}`
        );
        return;
    }

    const name = `AdvancedUpgrader-${Game.time}`;

    const result = spawn.spawnCreep(this.body, name, {
        memory: {
            role: this.role,
            working: false
        }
    });

    if (result === OK) {
        console.log("[AdvancedUpgrader] Начато создание юнита");
    } else {
        console.log(
            `[AdvancedUpgrader] Ошибка создания: ${result}`
        );
    }
},


    // Работа апгрейдера
    run(creep, room) {
        const controller = room.controller;
        if (!controller) return;

        const energy = creep.store[RESOURCE_ENERGY];

        // Если энергия есть — улучшаем контроллер
        if (energy > 0) {
            const result = creep.upgradeController(controller);

            if (result === ERR_NOT_IN_RANGE) {
                creep.moveTo(controller, { reusePath: 20 });
            }

            return;
        }

        // Если энергии нет — ищем контейнер возле контроллера
        const container = this.findControllerContainer(room);
        if (!container) return;

        if (container.store[RESOURCE_ENERGY] === 0) return;

        const result = creep.withdraw(container, RESOURCE_ENERGY);

        if (result === ERR_NOT_IN_RANGE) {
            creep.moveTo(container, {
                range: 1,
                reusePath: 20
            });
        }
    }
};

module.exports = advancedUpgrader;
