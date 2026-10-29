
// Башня и закреплённые за ней контейнеры
const TOWER_ID = null;
const TOWER_CONTAINER_IDS = [];

// Максимальное количество перевозчиков
// с активным заказом на доставку башне
const MAX_TOWER_DELIVERY_CARRIERS = 0;

// Тело обслуживающего башню
const TOWER_SUPPORT_BODY = [
    CARRY,
    CARRY,
    WORK,
    MOVE,
    MOVE,
    MOVE
];

// Очистить заказ доставки башне
function clearTowerDeliveryOrder(creep, helpers) {
    helpers.releaseEnergyReservation(creep);

    delete creep.memory.towerDeliveryTargetId;
    delete creep.memory.towerDeliverySourceId;
    delete creep.memory.towerDeliveryAmount;
    delete creep.memory.towerDeliveryActive;
}

function runTowerContainerDeliveryMode(creep, homeRoom, helpers) {
    const capacity = creep.store.getCapacity(RESOURCE_ENERGY);

    // Если перевозчик уже взял заказ, продолжаем его выполнять
    let targetId = creep.memory.towerDeliveryTargetId;

    // Ищем новый заказ только для пустого перевозчика
    if (!targetId) {
        if (creep.store[RESOURCE_ENERGY] > 0) return false;
        // Считаем перевозчиков с активным заказом башни
        const towerDeliveryCarriers = Object.values(Game.creeps).filter(
            other =>
                other.memory.role === "carrier" &&
                other.memory.towerDeliveryActive
        ).length;

        // Не выдаём больше двух заказов одновременно
        if (towerDeliveryCarriers >= MAX_TOWER_DELIVERY_CARRIERS) {
            return false;
        }
        // Storage домашней комнаты — единственный источник энергии
        const storage = homeRoom.find(FIND_MY_STRUCTURES, {
            filter: structure =>
                structure.structureType === STRUCTURE_STORAGE
        })[0];

        if (!storage) return false;

        const reserved = helpers.getReservedEnergy(storage.id, creep.name);

        const availableEnergy =
            storage.store[RESOURCE_ENERGY] - reserved;

        // Ищем контейнер, способный принять полную загрузку

        // Ищем контейнер с учётом уже заказанной энергии
        for (const id of TOWER_CONTAINER_IDS) {
            const container = Game.getObjectById(id);

            if (
                !container ||
                container.structureType !== STRUCTURE_CONTAINER
            ) continue;

            // Считаем энергию, которую другие перевозчики
            // уже везут в этот контейнер
            const incomingEnergy = Object.values(Game.creeps)
                .filter(other =>
                    other.name !== creep.name &&
                    other.memory.towerDeliveryTargetId === container.id
                )
                .reduce((sum, other) =>
                    sum + (other.memory.towerDeliveryAmount || 0), 0);

            // Свободное место с учётом ожидаемых поставок
            const freeCapacity =
                container.store.getFreeCapacity(RESOURCE_ENERGY);

            const remainingCapacity = freeCapacity - incomingEnergy;

            // Нет места даже для минимального заказа
            if (remainingCapacity <= 0) continue;

            // Размер заказа не может превышать:
            // 1. Грузоподъёмность перевозчика
            // 2. Доступную энергию в Storage
            // 3. Оставшееся место в контейнере
            // Перевозчик должен быть загружен полностью
            if (availableEnergy < capacity) continue;
            if (remainingCapacity < capacity) continue;

            const deliveryAmount = capacity;

            targetId = container.id;

            creep.memory.towerDeliveryTargetId = container.id;
            creep.memory.towerDeliverySourceId = storage.id;
            creep.memory.towerDeliveryAmount = deliveryAmount;
            creep.memory.towerDeliveryActive = true;

            // Резервируем только энергию текущего заказа
            helpers.reserveEnergy(creep, storage, deliveryAmount);

            console.log(
                "[БАШНЯ] Перевозчик",
                creep.name,
                "получил заказ на доставку",
                deliveryAmount,
                "энергии"
            );

            break;
        }

        // Подходящего заказа нет
        if (!targetId) return false;
    }

    const container = Game.getObjectById(
        creep.memory.towerDeliveryTargetId
    );

    const storage = Game.getObjectById(
        creep.memory.towerDeliverySourceId
    );

    const amount = creep.memory.towerDeliveryAmount;

    // Проверяем, существуют ли объекты заказа
    if (
        !container ||
        !storage ||
        !Number.isFinite(amount)
    ) {
        clearTowerDeliveryOrder(creep, helpers);
        return false;
    }

    // ФАЗА 1: забираем из Storage строго согласованный объём
    if (creep.store[RESOURCE_ENERGY] === 0) {
        if (storage.store[RESOURCE_ENERGY] < amount) {
            clearTowerDeliveryOrder(creep, helpers);
            return false;
        }

        const result = creep.withdraw(
            storage,
            RESOURCE_ENERGY,
            amount
        );

        if (result === ERR_NOT_IN_RANGE) {
            creep.moveTo(storage, { range: 1, reusePath: 20 });
        } else if (result === OK) {
            helpers.releaseEnergyReservation(creep);
        } else if (
            result === ERR_NOT_ENOUGH_RESOURCES ||
            result === ERR_INVALID_TARGET
        ) {
            clearTowerDeliveryOrder(creep, helpers);
        }

        return true;
    }

    // ФАЗА 2: выгружаем весь заказ в назначенный контейнер
    if (creep.store[RESOURCE_ENERGY] !== amount) {
        // Не смешиваем этот заказ с частичной загрузкой
        clearTowerDeliveryOrder(creep, helpers);
        return false;
    }

    // Если за время пути контейнер перестал вмещать весь груз,
    // сохраняем заказ и ждём освобождения места
    if (
        container.store.getFreeCapacity(RESOURCE_ENERGY) < amount
    ) {
        return true;
    }

    const result = creep.transfer(
        container,
        RESOURCE_ENERGY,
        amount
    );

    if (result === ERR_NOT_IN_RANGE) {
        creep.moveTo(container, { range: 1, reusePath: 20 });
    } else if (result === OK) {
        console.log(
            "[БАШНЯ] Перевозчик",
            creep.name,
            "доставил",
            amount,
            "энергии"
        );

        clearTowerDeliveryOrder(creep, helpers);

        // После доставки возвращаемся к спавну
        creep.memory.returningToBase = true;

    } else if (
        result === ERR_NOT_ENOUGH_RESOURCES ||
        result === ERR_INVALID_TARGET
    ) {
        // Не удаляем заказ при временной ошибке:
        // следующий тик сможет повторить попытку
        if (result === ERR_INVALID_TARGET) {
            clearTowerDeliveryOrder(creep, helpers);
        }
    }

    return true;
}

// РЕЖИМ РАБОТЫ БАШНИ — ОБОРОНА
function defendWithTower(tower, hostiles) {
    if (tower.store[RESOURCE_ENERGY] < 10) return;

    const state = Memory.towerControl;

    if (!state || state.mode !== "defense") return;

    // Если аварийный ремонт уже начат,
    // продолжаем его до сохранённого целевого уровня.
    if (state.emergencyTargetId) {
        const target = Game.getObjectById(state.emergencyTargetId);

        if (
            target &&
            (
                target.structureType === STRUCTURE_WALL ||
                target.structureType === STRUCTURE_RAMPART
            ) &&
            target.hits < state.emergencyTargetHits
        ) {
            tower.repair(target);
            return;
        }

        // Цель достигла нужной прочности или больше недоступна.
        state.emergencyTargetId = null;
        state.emergencyTargetHits = null;
    }

    // Ищем стены и рампарты, повреждённые до критического уровня.
    const defenses = tower.room.find(FIND_STRUCTURES, {
        filter: structure =>
            structure.structureType === STRUCTURE_WALL ||
            structure.structureType === STRUCTURE_RAMPART
    });

    const criticalTargets = defenses.filter(structure => {
        if (structure.structureType === STRUCTURE_WALL) {
            return state.wallCritical !== null &&
                structure.hits <= state.wallCritical;
        }

        return state.rampartCritical !== null &&
            structure.hits <= state.rampartCritical;
    });

    // Сначала восстанавливаем самое повреждённое
    // относительно среднего уровня укрепление.
    if (criticalTargets.length > 0) {
        criticalTargets.sort((a, b) => {
            const averageA = a.structureType === STRUCTURE_WALL
                ? state.wallAverage
                : state.rampartAverage;

            const averageB = b.structureType === STRUCTURE_WALL
                ? state.wallAverage
                : state.rampartAverage;

            return (a.hits / averageA) - (b.hits / averageB);
        });

        const target = criticalTargets[0];

        // Цель ремонта зависит от типа укрепления.
        const targetHits = target.structureType === STRUCTURE_WALL
            ? state.wallAverage
            : state.rampartAverage;

        state.emergencyTargetId = target.id;
        state.emergencyTargetHits = targetHits;

        tower.repair(target);
        return;
    }

    // Критических повреждений нет — атакуем противника.
    let enemy = Game.getObjectById(state.enemyId);

    if (!enemy || !hostiles.some(hostile => hostile.id === enemy.id)) {
        enemy = hostiles[0];
        state.enemyId = enemy.id;
    }

    tower.attack(enemy);
}


// Переключение режимов работы башни
function manageTower() {
    const tower = Game.getObjectById(TOWER_ID);

    if (!tower) return;

    const hostiles = tower.room.find(FIND_HOSTILE_CREEPS);

    if (hostiles.length > 0) {
        // Временно передаём управление оборонительной логике.
        defendWithTower(tower, hostiles);
    } else {
        // Врагов нет — работаем в режиме стройки.
        repairTowerDefenses();
    }
}

// Расчёт средней прочности стен и рампартов
function calculateTowerDefenseStats(room) {
    const walls = room.find(FIND_STRUCTURES, {
        filter: structure =>
            structure.structureType === STRUCTURE_WALL
    });

    const ramparts = room.find(FIND_STRUCTURES, {
        filter: structure =>
            structure.structureType === STRUCTURE_RAMPART
    });

    // Средняя прочность стен
    const wallAverage = walls.length > 0
        ? walls.reduce((sum, wall) => sum + wall.hits, 0) / walls.length
        : null;

    // Средняя прочность рампартов
    const rampartAverage = ramparts.length > 0
        ? ramparts.reduce((sum, rampart) => sum + rampart.hits, 0) / ramparts.length
        : null;

    return {
        wallAverage,
        rampartAverage,

        // Критическая прочность стен — 80% от их среднего значения
        wallCritical: wallAverage !== null
            ? wallAverage * TOWER_CRITICAL_RATIO
            : null,

        // Критическая прочность рампартов — 80% от их среднего значения
        rampartCritical: rampartAverage !== null
            ? rampartAverage * TOWER_CRITICAL_RATIO
            : null
    };
}


// Переключение режимов работы башни
function manageTower() {
    const tower = Game.getObjectById(TOWER_ID);

    if (!tower) return;

    const hostiles = tower.room.find(FIND_HOSTILE_CREEPS);

    if (hostiles.length > 0) {
        // Если башня только переходит в режим обороны,
        // один раз рассчитываем среднюю прочность укреплений.
        if (
            !Memory.towerControl ||
            Memory.towerControl.mode !== "defense"
        ) {
            const stats = calculateTowerDefenseStats(tower.room);

            Memory.towerControl = {
                mode: "defense",
                enemyId: hostiles[0].id,

                emergencyTargetId: null,
                emergencyTargetHits: null,

                ...stats
            };

            console.log(
                `[БАШНЯ] Режим обороны. ` +
                `Средняя прочность стен: ${stats.wallAverage}, ` +
                `рампартов: ${stats.rampartAverage}`
            );
        }

        // Передаём управление оборонительной логике.
        defendWithTower(tower, hostiles);
    } else {
        // Врагов нет — сбрасываем состояние обороны.
        delete Memory.towerControl;

        // Возвращаемся к мирному укреплению.
        repairTowerDefenses();
    }
}

// Логика работы крипа поддержки башни
function runTowerSupport(creep, spawn) {
    const tower = Game.getObjectById(TOWER_ID);

    // Башня недоступна — пока ничего не делаем
    if (!tower) return;

    // Получаем только контейнеры, закреплённые за башней
    const containers = TOWER_CONTAINER_IDS
        .map(id => Game.getObjectById(id))
        .filter(container =>
            container &&
            container.structureType === STRUCTURE_CONTAINER
        );

    // Если контейнеров нет, не используем другие источники энергии
    if (containers.length === 0) return;

    const energy = creep.store[RESOURCE_ENERGY];

    // 1. Если у крипа есть энергия, сначала снабжаем башню
    if (energy > 0 && tower.store.getFreeCapacity(RESOURCE_ENERGY) > 0) {
        const result = creep.transfer(tower, RESOURCE_ENERGY);

        if (result === ERR_NOT_IN_RANGE) {
            creep.moveTo(tower, { range: 1, reusePath: 20 });
        }

        return;
    }

    // 2. Если энергии нет, забираем её из назначенных контейнеров
    if (energy === 0) {
        const container = containers.find(item =>
            item.store[RESOURCE_ENERGY] > 0
        );

        if (!container) return;

        const result = creep.withdraw(container, RESOURCE_ENERGY);

        if (result === ERR_NOT_IN_RANGE) {
            creep.moveTo(container, { range: 1, reusePath: 20 });
        }

        return;
    }

    // 3. Если башня заполнена, ремонтируем её
    if (tower.hits < tower.hitsMax) {
        const result = creep.repair(tower);

        if (result === ERR_NOT_IN_RANGE) {
            creep.moveTo(tower, { reusePath: 20 });
        }

        return;
    }

    // 4. Если башня исправна, ремонтируем назначенные контейнеры
    const damagedContainer = containers.find(container =>
        container.hits < container.hitsMax
    );

    if (damagedContainer) {
        const result = creep.repair(damagedContainer);

        if (result === ERR_NOT_IN_RANGE) {
            creep.moveTo(damagedContainer, { reusePath: 20 });
        }
    }
}

module.exports = {
    runTowerContainerDeliveryMode
};