const towerDelivery = require("towerDelivery");
const towerSpawnDefense = require("towerSpawnDefense");

const roomConfig = require("roomConfig");

// Модуль перевозчиков
const advancedUpgrader = require("advancedUpgrader");
const builderModule = require("builder");


const DESIRED_CARRIERS = 2;

// Тела перевозчиков по количеству построенных Extensions.
const CARRIER_BODY_Version_0 = [
    CARRY, CARRY, CARRY, CARRY,
    MOVE, MOVE
];

const CARRIER_BODY_Version_2 = [
    CARRY, CARRY, CARRY, CARRY, CARRY,
    MOVE, MOVE, MOVE
];

const CARRIER_BODY_Version_5 = [
    CARRY, CARRY, CARRY, CARRY, CARRY, CARRY, CARRY,
    MOVE, MOVE, MOVE, MOVE
];

const CARRIER_BODY_Version_8 = [
    CARRY, CARRY, CARRY, CARRY, CARRY, CARRY, CARRY,
    MOVE, MOVE, MOVE, MOVE, MOVE, MOVE, MOVE
];

// Получаем настройки создания перевозчика, сохраняя прежние условия.
function getSpawnConfig(spawn, creeps, hasContainers) {
    const countRole = role =>
        creeps.filter(creep => creep.memory.role === role).length;

    const hasStorage = spawn.room.find(FIND_MY_STRUCTURES, {
        filter: structure =>
            structure.structureType === STRUCTURE_STORAGE
    }).length > 0;

    const hasActiveMiner = creeps.some(creep =>
        creep.memory.role === "miner" &&
        !creep.spawning
    );

    const desired = (
        hasStorage ||
        (hasContainers && hasActiveMiner)
    ) ? DESIRED_CARRIERS : 0;

    const extensions = spawn.room.find(FIND_MY_STRUCTURES, {
        filter: structure =>
            structure.structureType === STRUCTURE_EXTENSION
    });

    let body;

    if (countRole("carrier") === 0) {
        body = CARRIER_BODY_Version_0;
    } else if (extensions.length >= 8) {
        body = CARRIER_BODY_Version_8;
    } else if (extensions.length >= 5) {
        body = CARRIER_BODY_Version_5;
    } else if (extensions.length >= 2) {
        body = CARRIER_BODY_Version_2;
    } else {
        body = CARRIER_BODY_Version_0;
    }

    return { desired, body };
}


// Доставка энергии до контейнера контроллера
function runControllerContainerDeliveryMode(creep, homeRoom, helpers) {
    const capacity = creep.store.getCapacity(RESOURCE_ENERGY);

    let targetId = creep.memory.controllerDeliveryTargetId;

    // Новый заказ выдаём только пустому перевозчику
    if (!targetId) {
        if (creep.store[RESOURCE_ENERGY] > 0) return false;

        const controllerContainer =
            advancedUpgrader.findControllerContainer(homeRoom);

        if (!controllerContainer) return false;

        const containerCapacity =
            controllerContainer.store.getCapacity(RESOURCE_ENERGY);

        const containerEnergy =
            controllerContainer.store[RESOURCE_ENERGY] || 0;

        // Контейнер должен содержать меньше половины энергии
        if (containerEnergy >= containerCapacity / 2) return false;

        // Не выдаём заказ, если контейнер уже закреплён за другим
        const alreadyAssigned = Object.values(Game.creeps).some(other =>
            other.name !== creep.name &&
            other.memory.controllerDeliveryTargetId ===
            controllerContainer.id
        );

        if (alreadyAssigned) return false;

        // На полную загрузку должно хватать места в контейнере
        const freeCapacity =
            controllerContainer.store.getFreeCapacity(RESOURCE_ENERGY);

        if (freeCapacity < capacity) return false;

        // Домашний Storage — единственный источник энергии
        const storage = homeRoom.find(FIND_MY_STRUCTURES, {
            filter: structure =>
                structure.structureType === STRUCTURE_STORAGE
        })[0];

        if (!storage) return false;

        // Не начинаем новую доставку, если запас меньше 20 000
        const storageEnergy =
            storage.store[RESOURCE_ENERGY] || 0;

        if (storageEnergy < 20000) return false;

        const reserved = helpers.getReservedEnergy(storage.id, creep.name);

        const availableEnergy =
            storage.store[RESOURCE_ENERGY] - reserved;

        // Проверяем, хватает ли энергии на полную загрузку
        if (availableEnergy < capacity) return false;

        // Закрепляем заказ за перевозчиком
        targetId = controllerContainer.id;

        creep.memory.controllerDeliveryTargetId =
            controllerContainer.id;

        creep.memory.controllerDeliverySourceId =
            storage.id;

        creep.memory.controllerDeliveryAmount = capacity;

        helpers.reserveEnergy(creep, storage, capacity);
    }

    const target = Game.getObjectById(
        creep.memory.controllerDeliveryTargetId
    );

    const storage = Game.getObjectById(
        creep.memory.controllerDeliverySourceId
    );

    const amount = creep.memory.controllerDeliveryAmount;

    // Проверяем, что заказ всё ещё действителен
    if (
        !target ||
        !storage ||
        !Number.isFinite(amount)
    ) {
        helpers.releaseEnergyReservation(creep);
        delete creep.memory.controllerDeliveryTargetId;
        delete creep.memory.controllerDeliverySourceId;
        delete creep.memory.controllerDeliveryAmount;
        return false;
    }

    // Фаза 1: забираем полную загрузку из Storage
    if (creep.store[RESOURCE_ENERGY] === 0) {
        if (storage.store[RESOURCE_ENERGY] < amount) {
            helpers.releaseEnergyReservation(creep);
            delete creep.memory.controllerDeliveryTargetId;
            delete creep.memory.controllerDeliverySourceId;
            delete creep.memory.controllerDeliveryAmount;
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
            helpers.releaseEnergyReservation(creep);
            delete creep.memory.controllerDeliveryTargetId;
            delete creep.memory.controllerDeliverySourceId;
            delete creep.memory.controllerDeliveryAmount;
            return false;
        }

        return true;
    }

    // Не смешиваем заказ с другой загрузкой
    if (creep.store[RESOURCE_ENERGY] !== amount) {
        helpers.releaseEnergyReservation(creep);
        delete creep.memory.controllerDeliveryTargetId;
        delete creep.memory.controllerDeliverySourceId;
        delete creep.memory.controllerDeliveryAmount;
        return false;
    }

    // Ждём, если контейнер пока не может принять весь груз
    if (
        target.store.getFreeCapacity(RESOURCE_ENERGY) < amount
    ) {
        return true;
    }

    // Фаза 2: доставляем полную загрузку
    const result = creep.transfer(
        target,
        RESOURCE_ENERGY,
        amount
    );

    if (result === ERR_NOT_IN_RANGE) {
        creep.moveTo(target, { range: 1, reusePath: 20 });
    } else if (result === OK) {
        delete creep.memory.controllerDeliveryTargetId;
        delete creep.memory.controllerDeliverySourceId;
        delete creep.memory.controllerDeliveryAmount;
        creep.memory.returningToBase = true;
    } else if (result === ERR_INVALID_TARGET) {
        helpers.releaseEnergyReservation(creep);
        delete creep.memory.controllerDeliveryTargetId;
        delete creep.memory.controllerDeliverySourceId;
        delete creep.memory.controllerDeliveryAmount;
        return false;
    }

    return true;
}

// Проверить, назначен ли приёмник другому перевозчику
function isDeliveryTargetAssigned(targetId, creepName) {
    return Object.values(Game.creeps).some(other =>
        other.name !== creepName &&
        other.memory.deliveryTargetId === targetId
    );
}

// Управление созданием перевозчиков
function manageSpawning(spawn) {
    if (spawn.spawning) return false;

    const creeps = Object.values(Game.creeps);

    const hasContainers = [
        spawn.room.name,
        ...roomConfig.REMOTE_ROOMS
    ].some(roomName => {
        const room = Game.rooms[roomName];

        if (!room) return false;

        return room.find(FIND_STRUCTURES, {
            filter: structure =>
                structure.structureType === STRUCTURE_CONTAINER
        }).length > 0;
    });

    const config = getSpawnConfig(
        spawn,
        creeps,
        hasContainers
    );

    const carrierCount = creeps.filter(creep =>
        creep.memory.role === "carrier"
    ).length;

    if (carrierCount >= config.desired) return false;

    const cost = config.body.reduce(
        (total, part) => total + BODYPART_COST[part],
        0
    );

    if (spawn.room.energyAvailable < cost) return false;

    const name = "Carrier_" + Game.time;

    const result = spawn.spawnCreep(
        config.body,
        name,
        {
            memory: {
                role: "carrier",
                working: false
            }
        }
    );

    if (result === OK) {
        console.log("Создаём крипа:", name, "роль: carrier");
        return true;
    }

    return false;
}



// Поведение перевозчика
function runCarrier(creep, spawn, homeRoom, helpers) {


    // Возвращение на базу после доставки
    if (creep.memory.returningToBase) {
        if (creep.pos.isNearTo(spawn)) {
            delete creep.memory.returningToBase;

            // Освобождаем слот башни после возвращения
            delete creep.memory.towerDeliveryActive;
        } else {
            creep.moveTo(spawn, {
                range: 1,
                reusePath: 20
            });
            return;
        }
    }

    const energy = creep.store[RESOURCE_ENERGY];
    const capacity = creep.store.getCapacity(RESOURCE_ENERGY);
    const freeCapacity = creep.store.getFreeCapacity(RESOURCE_ENERGY);

    const releaseReservation = () => {
        helpers.releaseEnergyReservation(creep);
    };

    // Если энергии достаточно — переключаемся на доставку
    if (creep.store[RESOURCE_ENERGY] >= capacity / 2) {
        creep.memory.working = true;
    }

    // Если энергии нет — переключаемся на поиск
    if (creep.store[RESOURCE_ENERGY] === 0) {
        creep.memory.working = false;
    }

    // Если перевозчик уже закреплён за строителем,
    // сначала продолжаем специальную доставку
    if (creep.memory.builderDeliveryTarget) {
        const handled = builderModule.runBuilderDeliveryMode(
            creep,
            homeRoom,
            roomConfig.REMOTE_ROOMS,
            helpers
        );

        if (handled) return;
    }

    // Специальный режим доставки энергии в контейнер башни
    if (towerDelivery.runTowerContainerDeliveryMode(creep, homeRoom, helpers)) {
        return;
    }

    // Специальный режим доставки энергии в контейнер контроллера
    if (runControllerContainerDeliveryMode(creep, homeRoom, helpers)) {
        return;
    }

    // Специальное снабжение оборонительных башен
    if (towerSpawnDefense.runCarrierDefenseMode(creep, homeRoom)) {
        return;
    }

    // РЕЖИМ ДОСТАВКИ
    if (creep.memory.working) {
        releaseReservation();

        let target = null;

        // Если цель уже назначена этому перевозчику,
        // продолжаем доставку именно туда
        if (creep.memory.deliveryTargetId) {
            target = Game.getObjectById(
                creep.memory.deliveryTargetId
            );

            // Освобождаем назначение, если цель исчезла
            // или уже не нуждается в энергии
            if (
                !target ||
                target.store.getFreeCapacity(RESOURCE_ENERGY) === 0
            ) {
                delete creep.memory.deliveryTargetId;
                target = null;
            }
        }

        // Приоритет 1: Spawn
        if (
            !target &&
            spawn.store.getFreeCapacity(RESOURCE_ENERGY) > 0 &&
            !isDeliveryTargetAssigned(spawn.id, creep.name)
        ) {
            target = spawn;
        }

        // Приоритет 2: свободный Extension
        if (!target) {
            const extensions = homeRoom.find(FIND_MY_STRUCTURES, {
                filter: structure =>
                    structure.structureType === STRUCTURE_EXTENSION &&
                    structure.store.getFreeCapacity(RESOURCE_ENERGY) > 0 &&
                    !isDeliveryTargetAssigned(
                        structure.id,
                        creep.name
                    )
            });

            if (extensions.length > 0) {
                target = extensions[0];
            }
        }

        // Приоритет 3: строитель из очереди
        if (!target) {
            const assignedBuilder =
                builderModule.claimBuilderEnergyRequest(creep);

            if (assignedBuilder) {
                builderModule.runBuilderDeliveryMode(
                    creep,
                    homeRoom,
                    roomConfig.REMOTE_ROOMS,
                    helpers
                );
                return;
            }
        }

        // Приоритет 4: Storage
        if (!target) {
            target = homeRoom.find(FIND_MY_STRUCTURES, {
                filter: structure =>
                    structure.structureType === STRUCTURE_STORAGE &&
                    structure.store.getFreeCapacity(RESOURCE_ENERGY) > 0
            })[0];
        }

        // Приоритет 5: контейнер возле контроллера
        const storageEnergy = homeRoom.storage
            ? homeRoom.storage.store[RESOURCE_ENERGY] || 0
            : 0;

        if (!target && storageEnergy >= 20000) {
            const controllerContainer =
                advancedUpgrader.findControllerContainer(homeRoom);

            if (controllerContainer) {
                const containerCapacity =
                    controllerContainer.store.getCapacity(RESOURCE_ENERGY);

                const containerEnergy =
                    controllerContainer.store[RESOURCE_ENERGY] || 0;

                const incomingEnergy = Object.values(Game.creeps)
                    .filter(other =>
                        other.name !== creep.name &&
                        other.memory.deliveryTargetId ===
                        controllerContainer.id
                    )
                    .reduce(
                        (sum, other) =>
                            sum + other.store[RESOURCE_ENERGY],
                        0
                    );

                if (
                    containerEnergy + incomingEnergy <
                    containerCapacity / 2 &&
                    !isDeliveryTargetAssigned(
                        controllerContainer.id,
                        creep.name
                    )
                ) {
                    target = controllerContainer;
                }
            }
        }

        if (target) {
            // Закрепляем цель за перевозчиком
            creep.memory.deliveryTargetId = target.id;

            const result = creep.transfer(
                target,
                RESOURCE_ENERGY
            );

            if (result === ERR_NOT_IN_RANGE) {
                creep.moveTo(target, { reusePath: 20 });
            } else if (
                result === OK ||
                result === ERR_FULL ||
                result === ERR_INVALID_TARGET
            ) {
                delete creep.memory.deliveryTargetId;
            }

            return;
        }

        // Все приёмники заполнены.
        // Если энергии меньше половины — отправляемся пополняться.
        if (energy < capacity / 2) {
            creep.memory.working = false;
        } else {
            // Иначе возвращаемся к спавну и ждём
            const spawnPos = spawn.pos;

            if (creep.pos.getRangeTo(spawnPos) > 3) {
                creep.moveTo(spawnPos, { reusePath: 20 });
            }

            return;
        }
    }

    // РЕЖИМ ПОИСКА ЭНЕРГИИ

    // Приоритет: подобрать энергию после погибших крипов
    if (creep.store[RESOURCE_ENERGY] < capacity / 2) {

        // Освобождаем резерв контейнера:
        // сначала проверяем оставленные ресурсы
        releaseReservation();

        const recoveryRoomNames = [
            creep.room.name,
            homeRoom.name,
            ...roomConfig.REMOTE_ROOMS
        ];

        let recoveryTarget = null;
        let recoveryType = null;

        for (const roomName of [...new Set(recoveryRoomNames)]) {
            const room = Game.rooms[roomName];

            // Проверяем только видимые комнаты
            if (!room) continue;

            // Сначала проверяем могилы погибших крипов
            const tombstones = room.find(FIND_TOMBSTONES, {
                filter: tombstone =>
                    tombstone.store[RESOURCE_ENERGY] > 0
            });

            if (tombstones.length > 0) {
                const availableTombstones = tombstones.filter(
                    tombstone =>
                        !Object.values(Game.creeps).some(other =>
                            other.name !== creep.name &&
                            other.memory.recoveryTargetId === tombstone.id
                        )
                );

                if (availableTombstones.length > 0) {
                    recoveryTarget = availableTombstones[0];
                    recoveryType = "tombstone";
                    creep.memory.recoveryTargetId =
                        recoveryTarget.id;
                    break;
                }
            }

            // Затем проверяем энергию, выпавшую на землю
            const droppedResources = room.find(
                FIND_DROPPED_RESOURCES,
                {
                    filter: resource =>
                        resource.resourceType === RESOURCE_ENERGY
                }
            );

            if (droppedResources.length > 0) {
                const availableDrops = droppedResources.filter(
                    resource =>
                        !Object.values(Game.creeps).some(other =>
                            other.name !== creep.name &&
                            other.memory.recoveryTargetId === resource.id
                        )
                );

                if (availableDrops.length > 0) {
                    recoveryTarget = availableDrops[0];
                    recoveryType = "dropped";
                    creep.memory.recoveryTargetId =
                        recoveryTarget.id;
                    break;
                }
            }
        }

        // Если нашли оставленную энергию — забираем её
        if (recoveryTarget) {
            let result;

            if (recoveryType === "tombstone") {
                result = creep.withdraw(
                    recoveryTarget,
                    RESOURCE_ENERGY
                );
            } else {
                result = creep.pickup(recoveryTarget);
            }

            if (result === ERR_NOT_IN_RANGE) {
                creep.moveTo(recoveryTarget, {
                    range: 1,
                    reusePath: 20
                });
            } else if (
                result === OK ||
                result === ERR_NOT_ENOUGH_RESOURCES ||
                result === ERR_INVALID_TARGET
            ) {
                delete creep.memory.recoveryTargetId;
            }

            // В этом тике контейнеры не проверяем
            return;
        }


        // Если энергии уже половина или больше, новую не забираем
        if (creep.store[RESOURCE_ENERGY] >= capacity / 2) {
            releaseReservation();
            creep.memory.working = true;
            return;
        }

        const roomNames = [
            ...roomConfig.REMOTE_ROOMS,
            homeRoom.name
        ];

        let container = creep.memory.energyReservationTargetId
            ? Game.getObjectById(
                creep.memory.energyReservationTargetId
            )
            : null;

        // Если цель исчезла, освобождаем резерв
        if (!container) {
            releaseReservation();
        }

        // Сбрасываем старый резерв, если это контейнер контроллера
        if (
            container &&
            container.structureType === STRUCTURE_CONTAINER
        ) {
            const controllerContainer =
                advancedUpgrader.findControllerContainer(container.room);

            if (
                controllerContainer &&
                controllerContainer.id === container.id
            ) {
                releaseReservation();
                container = null;
            }
        }

        // Если контейнер уже выбран, продолжаем путь к нему
        if (container) {
            const result = creep.withdraw(
                container,
                RESOURCE_ENERGY
            );

            if (result === ERR_NOT_IN_RANGE) {
                creep.moveTo(container, { reusePath: 20 });
            } else if (
                result === OK ||
                result === ERR_NOT_ENOUGH_RESOURCES ||
                result === ERR_INVALID_TARGET
            ) {
                releaseReservation();
            }

            return;
        }

        // Ищем контейнер с учётом общих резервов
        const neededEnergy = freeCapacity;

        // Проверяем, нуждается ли база в энергии
        const spawnNeedsEnergy =
            spawn.store.getFreeCapacity(RESOURCE_ENERGY) > 0;

        const extensionsNeedEnergy = homeRoom.find(
            FIND_MY_STRUCTURES,
            {
                filter: structure =>
                    structure.structureType === STRUCTURE_EXTENSION &&
                    structure.store.getFreeCapacity(RESOURCE_ENERGY) > 0
            }
        ).length > 0;

        // Storage используем как резерв, только если базе нужна энергия
        const builderWaiting =
            Array.isArray(Memory.builderEnergyQueue) &&
            Memory.builderEnergyQueue.length > 0;

        const allowStorage =
            spawnNeedsEnergy ||
            extensionsNeedEnergy ||
            builderWaiting;

        container = helpers.findEnergyContainer(
            creep,
            roomNames,
            neededEnergy,
            allowStorage,
            builderWaiting
        );

        if (!container) return;

        const reserved = helpers.getReservedEnergy(
            container.id,
            creep.name
        );

        const available =
            container.store[RESOURCE_ENERGY] - reserved;

        helpers.reserveEnergy(
            creep,
            container,
            Math.min(neededEnergy, available)
        );

        const result = creep.withdraw(
            container,
            RESOURCE_ENERGY
        );

        if (result === ERR_NOT_IN_RANGE) {
            creep.moveTo(container, { reusePath: 20 });
        } else if (
            result === OK ||
            result === ERR_NOT_ENOUGH_RESOURCES ||
            result === ERR_INVALID_TARGET
        ) {
            releaseReservation();
        }

        // Нет контейнера с достаточным доступным запасом
    }
}

module.exports = {
    run: runCarrier,
    getSpawnConfig,
    manageSpawning
};

