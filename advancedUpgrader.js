
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

    // Создание нового апгрейдера
    manageSpawning(spawn) {
        if (spawn.spawning) return;

        const room = spawn.room;

        // Storage должен быть построен
        if (!room.storage) return;

        // Должно быть построено не менее 17 расширителей
        const extensions = room.find(FIND_MY_STRUCTURES, {
            filter: structure =>
                structure.structureType === STRUCTURE_EXTENSION
        });

        if (extensions.length < 17) return;

        // Рядом с контроллером должен быть контейнер
        const container = this.findControllerContainer(room);
        if (!container) return;

        const creeps = Object.values(Game.creeps).filter(
            creep => creep.memory.role === this.role
        );

        if (creeps.length >= this.desiredCount) return;

        const cost = this.body.reduce(
            (total, part) => total + BODYPART_COST[part],
            0
        );

        if (spawn.room.energyAvailable < cost) return;

        const name = `AdvancedUpgrader-${Game.time}`;

        spawn.spawnCreep(this.body, name, {
            memory: {
                role: this.role,
                working: false
            }
        });
    },

    // Работа апгрейдера
    
run(creep, room) {
    const controller = room.controller;
    if (!controller) return;

    const container = this.findControllerContainer(room);
    if (!container) return;

    // Сначала апгрейдер должен добраться до контейнера
    if (!creep.memory.containerPostReached) {
        if (creep.pos.getRangeTo(container) > 1) {
            creep.moveTo(container, {
                range: 1,
                reusePath: 20
            });
            return;
        }

        // Апгрейдер уже стоит рядом с контейнером
        creep.memory.containerPostReached = true;
    }

    const energy = creep.store[RESOURCE_ENERGY];

    // Если энергия есть — улучшаем контроллер
    if (energy > 0) {
        const result = creep.upgradeController(controller);

        if (result === ERR_NOT_IN_RANGE) {
            creep.moveTo(controller, {
                reusePath: 20
            });
        }

        return;
    }

    // Если энергии нет — ждём её в контейнере
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
