// Башни, которые обслуживает модуль
const TOWERS = [
    {
        id: "6ae4ae90b979624aae30b7e3",
        energyThreshold: 0.70
    },
    {
        id: "6ae4ee5810bbc95d4e374f88",
        energyThreshold: 0.70
    }
];

// Радиус обнаружения противников для атаки башней
const TOWER_ATTACK_RANGE = 15;

// Целевая прочность стен и Ramparts
const TOWER_REPAIR_TARGET_HITS = 100000;

// Индекс башни, с которой начинать следующую проверку
if (Memory.lastServedTowerIndex === undefined) {
    Memory.lastServedTowerIndex = -1;
}

// Специальное снабжение оборонительной башни
function runCarrierDefenseMode(creep, homeRoom) {

    const assignment = Memory.towerSpawnDefenseAssignment;

    // Этот перевозчик не назначен на снабжение башни
    if (!assignment || assignment.creepName !== creep.name) {
        return false;
    }

    // Не вмешиваемся в другие специальные доставки
    if (
        creep.memory.builderDeliveryTarget ||
        creep.memory.towerDeliveryActive ||
        creep.memory.returningToBase
    ) {
        delete Memory.towerSpawnDefenseAssignment;
        return false;
    }

    const storage = homeRoom.storage;
    const tower = Game.getObjectById(assignment.towerId);

    // Если Storage или башня исчезли — освобождаем назначение
    if (!storage || !tower || tower.room.name !== homeRoom.name) {
        delete Memory.towerSpawnDefenseAssignment;
        return true;
    }

    // Если энергии нет — забираем её непосредственно из Storage
    if (creep.store[RESOURCE_ENERGY] === 0) {

        const result = creep.withdraw(
            storage,
            RESOURCE_ENERGY
        );

        if (result === ERR_NOT_IN_RANGE) {
            creep.moveTo(storage, {
                range: 1,
                reusePath: 20
            });
        } else if (
            result === ERR_NOT_ENOUGH_RESOURCES ||
            result === ERR_INVALID_TARGET
        ) {
            delete Memory.towerSpawnDefenseAssignment;
        }

        return true;
    }

    // Если энергия есть — направляемся к башне
    if (!creep.pos.isNearTo(tower)) {
        creep.moveTo(tower, {
            range: 1,
            reusePath: 20
        });

        return true;
    }

    // Проверяем, нуждается ли башня ещё в энергии
    const freeCapacity = tower.store.getFreeCapacity(RESOURCE_ENERGY);

    // Если башня уже заполнена — просто освобождаем назначение
    if (freeCapacity > 0) {

        // Делаем одну попытку передать энергию
        creep.transfer(tower, RESOURCE_ENERGY);
    }

    // После попытки освобождаем назначение
    delete Memory.towerSpawnDefenseAssignment;

    return true;
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

    const attackMemoryKey = "towerWasUnderAttack_" + room.name;
    const healMemoryKey = "towerHealTargets_" + room.name;

    // Получаем все доступные башни комнаты
    const activeTowers = TOWERS
        .map(config => Game.getObjectById(config.id))
        .filter(tower => tower && tower.room.name === room.name);

    // Проверяем, есть ли враги в радиусе хотя бы одной башни
    const enemiesDetected = activeTowers.some(tower =>
        tower.pos.findInRange(
            FIND_HOSTILE_CREEPS,
            TOWER_ATTACK_RANGE
        ).length > 0
    );

    // Если обнаружен враг — запоминаем нападение
    if (enemiesDetected) {
        Memory[attackMemoryKey] = true;

        // Старый список лечения больше не актуален
        delete Memory[healMemoryKey];
    }

    // Если нападение закончилось — один раз составляем список раненых
    if (!enemiesDetected && Memory[attackMemoryKey]) {

        const wounded = room.find(FIND_MY_CREEPS, {
            filter: creep => creep.hits < creep.hitsMax
        });

        Memory[healMemoryKey] = wounded.map(creep => creep.id);

        delete Memory[attackMemoryKey];
    }

    // Обновляем список: убираем погибших и уже вылеченных
    if (Memory[healMemoryKey]) {
        Memory[healMemoryKey] = Memory[healMemoryKey].filter(id => {
            const creep = Game.getObjectById(id);

            return creep && creep.hits < creep.hitsMax;
        });

        if (Memory[healMemoryKey].length === 0) {
            delete Memory[healMemoryKey];
        }
    }

    // Управляем каждой башней
    for (let i = 0; i < activeTowers.length; i++) {

        const tower = activeTowers[i];
        const memoryKey = "towerTarget_" + tower.id;

        // Проверяем врагов непосредственно в этом тике
        const hostiles = tower.pos.findInRange(
            FIND_HOSTILE_CREEPS,
            TOWER_ATTACK_RANGE
        );

        // Если враги есть — атакуем
        if (hostiles.length > 0) {

            let target = Memory[memoryKey]
                ? Game.getObjectById(Memory[memoryKey])
                : null;

            // Проверяем сохранённую цель
            if (!target || !hostiles.some(creep => creep.id === target.id)) {
                delete Memory[memoryKey];

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
                Memory[memoryKey] = target.id;
            }

            tower.attack(target);
            continue;
        }

        // Врагов нет — удаляем старую цель
        delete Memory[memoryKey];

        // Сначала лечим раненых из сохранённого списка
        const healTargets = Memory[healMemoryKey];

        if (healTargets && healTargets.length > 0) {

            const wounded = healTargets
                .map(id => Game.getObjectById(id))
                .find(creep =>
                    creep &&
                    creep.hits < creep.hitsMax &&
                    tower.pos.getRangeTo(creep) <= 20
                );

            if (wounded) {
                tower.heal(wounded);
                continue;
            }
        }

        // Ищем повреждённые здания, включая контейнеры
        let repairTarget = tower.room.find(FIND_STRUCTURES, {
            filter: structure =>
                structure.structureType !== STRUCTURE_WALL &&
                structure.structureType !== STRUCTURE_RAMPART &&
                structure.hits < structure.hitsMax
        })[0];

        // Если повреждённых зданий нет — ищем стены и Ramparts
        if (!repairTarget) {
            repairTarget = tower.room.find(FIND_STRUCTURES, {
                filter: structure =>
                    (
                        structure.structureType === STRUCTURE_WALL ||
                        structure.structureType === STRUCTURE_RAMPART
                    ) &&
                    structure.hits < TOWER_REPAIR_TARGET_HITS
            })[0];
        }

        // Ремонтируем найденную цель
        if (repairTarget) {
            tower.repair(repairTarget);
        }
    }
}

module.exports = {
    runTowerDefense,
    manageCarrierAssignment,
    runCarrierDefenseMode,
    TOWERS
};
