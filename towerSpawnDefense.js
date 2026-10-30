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
            return {
                tower,
                index
            };
        }
    }

    return null;
}

// Назначение перевозчика для снабжения башни
function manageCarrierAssignment(room) {

    // Проверяем существующее назначение
    const assignment = Memory.towerSpawnDefenseAssignment;

    if (assignment) {
        const creep = Game.creeps[assignment.creepName];
        const tower = Game.getObjectById(assignment.towerId);

        if (
            creep &&
            creep.memory.role === "carrier" &&
            tower &&
            tower.room.name === room.name
        ) {
            const config = TOWERS.find(item => item.id === tower.id);

            if (config) {
                const energy = tower.store[RESOURCE_ENERGY];
                const capacity = tower.store.getCapacity(RESOURCE_ENERGY);

                if (energy <= capacity * config.energyThreshold) {
                    return;
                }
            }
        }

        // Назначение устарело
        delete Memory.towerSpawnDefenseAssignment;
    }

    // Для снабжения нужен Storage с запасом не менее 1000 энергии
    const storage = room.storage;

    if (!storage) return;
    if (storage.store[RESOURCE_ENERGY] < 1000) return;

    // Ищем свободного обычного Carrier
    const carrier = Object.values(Game.creeps).find(creep =>
        creep.memory.role === "carrier" &&
        !creep.spawning &&
        creep.store[RESOURCE_ENERGY] === 0 &&
        !creep.memory.builderDeliveryTarget &&
        !creep.memory.towerDeliveryActive &&
        !creep.memory.returningToBase &&
        !creep.memory.deliveryTargetId &&
        !creep.memory.energyReservationTargetId
    );

    if (!carrier) return;

    // Ищем следующую башню для обслуживания
    const result = findTowerNeedingEnergy(room);

    if (!result) return;

    // Сохраняем назначение
    Memory.towerSpawnDefenseAssignment = {
        creepName: carrier.name,
        towerId: result.tower.id
    };

    // Запоминаем последнюю назначенную башню
    Memory.lastServedTowerIndex = result.index;
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
    runTowerDefense,
    manageCarrierAssignment
};
