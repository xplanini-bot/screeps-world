// Башни, которые обслуживает модуль
const TOWERS = [
    {
        id: "ВСТАВЬ_ID_БАШНИ",
        energyThreshold: 0.70
    }
];

// Индекс башни, с которой начинать следующую проверку
let lastServedTowerIndex = -1;

// Найти следующую башню, которой требуется энергия
function findTowerNeedingEnergy(room) {
    for (let i = 1; i <= TOWERS.length; i++) {
        const index = (lastServedTowerIndex + i) % TOWERS.length;
        const config = TOWERS[index];

        const tower = Game.getObjectById(config.id);

        if (!tower) continue;
        if (tower.room.name !== room.name) continue;

        const energy = tower.store[RESOURCE_ENERGY];
        const capacity = tower.store.getCapacity(RESOURCE_ENERGY);

        if (energy <= capacity * config.energyThreshold) {
            lastServedTowerIndex = index;
            return tower;
        }
    }

    return null;
}
