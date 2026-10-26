// Тела апгрейдеров

const UPGRADER_BODY_Version_0 = [
    WORK, CARRY, MOVE
];

const UPGRADER_BODY_Version_2 = [
    WORK, WORK,
    CARRY, CARRY,
    MOVE, MOVE
];

const UPGRADER_BODY_Version_5 = [
    WORK, WORK, WORK,
    CARRY, CARRY,
    MOVE, MOVE, MOVE
];

const UPGRADER_BODY_Version_7 = [
    WORK, WORK, WORK,
    CARRY, CARRY, CARRY, CARRY,
    MOVE, MOVE, MOVE
];

// Выбор тела обычного апгрейдера
function getBody(room) {
    const extensions = room.find(FIND_MY_STRUCTURES, {
        filter: structure =>
            structure.structureType === STRUCTURE_EXTENSION
    });

    if (extensions.length >= 7) {
        return UPGRADER_BODY_Version_7;
    } else if (extensions.length >= 5) {
        return UPGRADER_BODY_Version_5;
    } else if (extensions.length >= 2) {
        return UPGRADER_BODY_Version_2;
    }

    return UPGRADER_BODY_Version_0;
}


// Создание обычных апгрейдеров
function manageSpawning(spawn, remoteRooms) {

    if (spawn.spawning) return false;

    const room = spawn.room;
    const creeps = Object.values(Game.creeps);

    // Проверяем наличие контейнеров в домашней и удалённых комнатах
    const roomNames = [...new Set([
        room.name,
        ...remoteRooms
    ])];

    const hasContainers = roomNames.some(roomName => {
        const targetRoom = Game.rooms[roomName];

        if (!targetRoom) return false;

        return targetRoom.find(FIND_STRUCTURES, {
            filter: structure =>
                structure.structureType === STRUCTURE_CONTAINER
        }).length > 0;
    });

    // Количество построенных расширителей
    const extensionCount = room.find(FIND_MY_STRUCTURES, {
        filter: structure =>
            structure.structureType === STRUCTURE_EXTENSION
    }).length;

    // Проверяем контейнер рядом с контроллером
    const controller = room.controller;

    const controllerContainerExists = !!controller &&
        room.find(FIND_STRUCTURES, {
            filter: structure =>
                structure.structureType === STRUCTURE_CONTAINER &&
                structure.pos.getRangeTo(controller) <= 1
        }).length > 0;

    // Проверяем наличие шахтёра
    const hasMiner = creeps.some(creep =>
        creep.memory.role === "miner"
    );

    // Проверяем наличие перевозчика
    const hasCarrier = creeps.some(creep =>
        creep.memory.role === "carrier"
    );

    // Определяем необходимое количество апгрейдеров
    const desiredUpgraders =
        !hasContainers ||
            !hasMiner ||
            (controllerContainerExists && extensionCount > 17)
            ? 0
            : room.controller.level >= 4
                ? 1
                : !hasCarrier
                    ? 1
                    : room.controller.level >= 3 &&
                        extensionCount >= 5 &&
                        extensionCount < 10
                        ? 1
                        : extensionCount >= 5
                            ? 3
                            : 1;

    // Проверяем текущее количество апгрейдеров
    const currentCount = creeps.filter(creep =>
        creep.memory.role === "upgrader"
    ).length;

    if (currentCount >= desiredUpgraders) {
        return false;
    }

    // Выбираем тело и проверяем стоимость
    const body = getBody(room);

    const cost = body.reduce(
        (total, part) => total + BODYPART_COST[part],
        0
    );

    // Если энергии недостаточно, разрешаем проверить следующую роль
    if (room.energyAvailable < cost) {
        return false;
    }

    // Создаём апгрейдера
    const name = "Upgrader_" + Game.time;

    const result = spawn.spawnCreep(
        body,
        name,
        {
            memory: {
                role: "upgrader",
                working: false
            }
        }
    );

    if (result === OK) {
        console.log("[UPGRADER] Создаём апгрейдера:", name);
    }

    return result === OK;
}

module.exports = {

    role: "upgrader",

    getBody: getBody,
    manageSpawning: manageSpawning,

    // Поведение обычного апгрейдера
    run: function (creep, homeRoom, helpers) {

        const {
            updateWorkingState,
            releaseEnergyReservation,
            findEnergyContainer,
            getReservedEnergy,
            reserveEnergy
        } = helpers;

        updateWorkingState(creep);

        const energy = creep.store[RESOURCE_ENERGY];

        // Если энергия уже получена, освобождаем резерв
        if (energy > 0) {
            releaseEnergyReservation(creep);
        }

        // Если энергии нет — проверяем, можно ли её брать
        if (energy === 0) {

            // Проверяем запас энергии в Storage
            const storage = homeRoom.storage;

            const storageHasSurplus = storage &&
                storage.store[RESOURCE_ENERGY] >
                storage.store.getCapacity(RESOURCE_ENERGY) * 0.2;

            // Проверяем незаполненные расширители
            const extensionsNeedEnergy = homeRoom.find(
                FIND_MY_STRUCTURES,
                {
                    filter: structure =>
                        structure.structureType === STRUCTURE_EXTENSION &&
                        structure.store.getFreeCapacity(RESOURCE_ENERGY) > 0
                }
            ).length > 0;

            // Если расширители не заполнены и запаса Storage недостаточно,
            // освобождаем резерв и ждём
            if (extensionsNeedEnergy && !storageHasSurplus) {
                releaseEnergyReservation(creep);
                return;
            }

            // Используем ранее выбранный контейнер, если он доступен
            let container = creep.memory.energyReservationTargetId
                ? Game.getObjectById(
                    creep.memory.energyReservationTargetId
                )
                : null;

            // Если контейнер недоступен или пуст, ищем другой
            if (
                !container ||
                !container.store ||
                container.store[RESOURCE_ENERGY] === 0
            ) {
                releaseEnergyReservation(creep);

                container = findEnergyContainer(
                    creep,
                    [homeRoom.name],
                    1
                );

                if (!container) return;

                const reserved = getReservedEnergy(
                    container.id,
                    creep.name
                );

                const available =
                    container.store[RESOURCE_ENERGY] - reserved;

                reserveEnergy(
                    creep,
                    container,
                    Math.min(
                        creep.store.getCapacity(RESOURCE_ENERGY),
                        available
                    )
                );
            }

            const result = creep.withdraw(
                container,
                RESOURCE_ENERGY
            );

            if (result === ERR_NOT_IN_RANGE) {
                creep.moveTo(container, {
                    range: 1,
                    reusePath: 20
                });
            } else if (
                result === ERR_NOT_ENOUGH_RESOURCES ||
                result === ERR_INVALID_TARGET
            ) {
                releaseEnergyReservation(creep);
            }

            return;
        }

        // Улучшаем домашний контроллер
        const controller = homeRoom.controller;

        if (!controller) return;

        // Подходим на соседнюю клетку
        if (creep.pos.getRangeTo(controller) > 1) {
            creep.moveTo(controller, {
                range: 1,
                reusePath: 5
            });

            return;
        }

        // Улучшаем контроллер
        creep.upgradeController(controller);
    }
};