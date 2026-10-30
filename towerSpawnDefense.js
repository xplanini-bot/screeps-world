// Башни, которые обслуживает модуль
const TOWERS = [
    {
        id: "ВСТАВЬ_ID_БАШНИ",
        energyThreshold: 0.70
    }
];

// Радиус обнаружения противников для атаки башней
const TOWER_ATTACK_RANGE = 15;

// Индекс башни, с которой начинать следующую проверку
if (Memory.lastServedTowerIndex === undefined) {
    Memory.lastServedTowerIndex = -1;
}

// Найти следующую башню, которой требуется энергия
function findTowerNeedingEnergy(room) {
    for (let i = 1; i <= TOWERS.length; i++) {
        const index = (Memory.lastServedTowerIndex + i) % TOWERS.length;
        const config = TOWERS[index];

        const tower = Game.getObjectById(config.id);

        if (!tower) continue;
        if (tower.room.name !== room.name) continue;

        const energy = tower.store[RESOURCE_ENERGY];
        const capacity = tower.store.getCapacity(RESOURCE_ENERGY);

        if (energy <= capacity * config.energyThreshold) {
            Memory.lastServedTowerIndex = index;
            return tower;
        }
    }

    return null;
}

// Управление атакой башен
function runTowerDefense(room) {

    for (const config of TOWERS) {

        const tower = Game.getObjectById(config.id);

        if (!tower) continue;
        if (tower.room.name !== room.name) continue;

        const memoryKey = "towerTarget_" + tower.id;

        // Проверяем ранее выбранную цель
        let target = Memory[memoryKey]
            ? Game.getObjectById(Memory[memoryKey])
            : null;

        // Проверяем, существует ли цель и находится ли она в радиусе
        if (
            !target ||
            target.my ||
            target.pos.roomName !== room.name ||
            tower.pos.getRangeTo(target) > TOWER_ATTACK_RANGE
        ) {
            delete Memory[memoryKey];
            target = null;
        }

        // Если цели нет, выбираем новую
        if (!target) {

            const hostiles = tower.pos.findInRange(
                FIND_HOSTILE_CREEPS,
                TOWER_ATTACK_RANGE
            );

            if (hostiles.length === 0) continue;

            // Сортируем по количеству активных TOUGH
            const sortedHostiles = hostiles.slice().sort((a, b) => {

                const toughA = a.getActiveBodyparts(TOUGH);
                const toughB = b.getActiveBodyparts(TOUGH);

                if (toughA !== toughB) {
                    return toughA - toughB;
                }

                return tower.pos.getRangeTo(a) -
                    tower.pos.getRangeTo(b);
            });

            target = sortedHostiles[0];

            // Запоминаем выбранную цель
            Memory[memoryKey] = target.id;
        }

        // Продолжаем атаковать выбранную цель
        tower.attack(target);
    }
}

module.exports = {
    runTowerDefense
};
