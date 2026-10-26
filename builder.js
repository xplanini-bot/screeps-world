// Тела строителей по поколениям Extensions

const BUILDER_BODY_Version_0 = [
    WORK, WORK,
    CARRY,
    MOVE
]; // 300 энергии

const BUILDER_BODY_Version_2 = [
    WORK, WORK,
    CARRY, CARRY,
    MOVE, MOVE
];

const BUILDER_BODY_Version_5 = [
    WORK, WORK, WORK,
    CARRY, CARRY,
    MOVE, MOVE, MOVE
];

const BUILDER_BODY_Version_8 = [
    WORK, WORK, WORK, WORK,
    CARRY, CARRY, CARRY,
    MOVE, MOVE, MOVE
];


// Создание обычных строителей
function manageSpawning(spawn, remoteRooms) {

    if (spawn.spawning) return false;

    const room = spawn.room;
    const creeps = Object.values(Game.creeps);

    const roomNames = [...new Set([
        room.name,
        ...remoteRooms
    ])];

    // Проверяем наличие контейнеров в домашней
    // или одной из удалённых комнат
    const hasContainers = roomNames.some(roomName => {
        const targetRoom = Game.rooms[roomName];

        if (!targetRoom) return false;

        return targetRoom.find(FIND_STRUCTURES, {
            filter: structure =>
                structure.structureType === STRUCTURE_CONTAINER
        }).length > 0;
    });

    // Проверяем наличие строительных площадок
    const hasConstructionSites = roomNames.some(roomName => {
        const targetRoom = Game.rooms[roomName];

        if (!targetRoom) return false;

        return targetRoom.find(
            FIND_MY_CONSTRUCTION_SITES
        ).length > 0;
    });

    // По прежним условиям нужен максимум один строитель
    const desiredBuilders =
        hasContainers && hasConstructionSites ? 1 : 0;

    // Считаем уже существующих и создающихся строителей
    const currentCount = creeps.filter(
        creep => creep.memory.role === "builder"
    ).length;

    if (currentCount >= desiredBuilders) return false;

    // Выбираем тело через функцию этого модуля
    const body = module.exports.getBody(room);

    const cost = body.reduce(
        (total, part) => total + BODYPART_COST[part],
        0
    );

    // Если энергии пока недостаточно, ждём следующего вызова
    if (room.energyAvailable < cost) return false;

    const name = "Builder_" + Game.time;

    const result = spawn.spawnCreep(
        body,
        name,
        {
            memory: {
                role: "builder",
                working: false
            }
        }
    );

    if (result === OK) {
        console.log("[BUILDER] Создаём строителя:", name);
    }

    return result === OK;
}

/* Очередь строителей, ожидающих энергию */

function removeBuilderEnergyRequest(builderName) {
    if (!Array.isArray(Memory.builderEnergyQueue)) {
        Memory.builderEnergyQueue = [];
        return;
    }

    Memory.builderEnergyQueue =
        Memory.builderEnergyQueue.filter(name => name !== builderName);
}

function requestBuilderEnergy(builder) {
    if (!Array.isArray(Memory.builderEnergyQueue)) {
        Memory.builderEnergyQueue = [];
    }

    // Если перевозчик уже закреплён за строителем,
    // повторную заявку не создаём
    const carrierName = builder.memory.energyDeliveryCarrier;
    const carrier = carrierName ? Game.creeps[carrierName] : null;

    if (
        carrier &&
        carrier.memory.builderDeliveryTarget === builder.name
    ) {
        removeBuilderEnergyRequest(builder.name);
        return;
    }

    // Удаляем устаревшее закрепление
    if (carrierName) {
        delete builder.memory.energyDeliveryCarrier;
    }

    // Не допускаем дубликатов в очереди
    if (!Memory.builderEnergyQueue.includes(builder.name)) {
        Memory.builderEnergyQueue.push(builder.name);

        console.log(
            "[СТРОИТЕЛЬ] Заявка на энергию:",
            builder.name
        );
    }
}

// Перевозчик забирает одну заявку из очереди
function claimBuilderEnergyRequest(carrier) {
    if (!Array.isArray(Memory.builderEnergyQueue)) {
        Memory.builderEnergyQueue = [];
    }

    while (Memory.builderEnergyQueue.length > 0) {
        const builderName = Memory.builderEnergyQueue.shift();
        const builder = Game.creeps[builderName];

        // Строитель погиб, сменил роль или уже получил энергию
        if (
            !builder ||
            builder.memory.role !== "builder" ||
            builder.store[RESOURCE_ENERGY] > 0
        ) {
            continue;
        }

        // Проверяем, не обслуживает ли его другой перевозчик
        const assignedCarrierName =
            builder.memory.energyDeliveryCarrier;

        const assignedCarrier = assignedCarrierName
            ? Game.creeps[assignedCarrierName]
            : null;

        if (
            assignedCarrier &&
            assignedCarrier.memory.builderDeliveryTarget === builder.name
        ) {
            continue;
        }

        // Старое назначение больше не действует
        if (assignedCarrierName) {
            delete builder.memory.energyDeliveryCarrier;
        }

        // Закрепляем строителя за этим перевозчиком
        carrier.memory.builderDeliveryTarget = builder.name;
        builder.memory.energyDeliveryCarrier = carrier.name;

        console.log(
            "[ПЕРЕВОЗЧИК] Принята заявка:",
            carrier.name,
            "->",
            builder.name
        );

        return builder;
    }

    return null;
}

module.exports = {

    role: "builder",

    // Выбор тела строителя по количеству построенных расширителей
    getBody: function (room) {

        const extensionCount = room.find(FIND_MY_STRUCTURES, {
            filter: structure =>
                structure.structureType === STRUCTURE_EXTENSION
        }).length;

        if (extensionCount >= 8) {
            return BUILDER_BODY_Version_8;
        } else if (extensionCount >= 5) {
            return BUILDER_BODY_Version_5;
        } else if (extensionCount >= 2) {
            return BUILDER_BODY_Version_2;
        }

        return BUILDER_BODY_Version_0;
    },

    manageSpawning: manageSpawning,
    removeBuilderEnergyRequest: removeBuilderEnergyRequest,
    requestBuilderEnergy: requestBuilderEnergy,
    claimBuilderEnergyRequest: claimBuilderEnergyRequest,

    // Поведение строителя
    run: function (creep, homeRoom, remoteRooms, helpers) {

        const {
            releaseEnergyReservation,
            findEnergyContainer,
            getReservedEnergy,
            reserveEnergy
        } = helpers;

        // Пока строитель создаётся, не обрабатываем его задачи
        if (creep.spawning) return;

        const hasCarrier = Object.values(Game.creeps).some(
            c => c.memory.role === "carrier"
        );

        // Если строитель получил энергию, его заявка больше не нужна
        if (creep.store[RESOURCE_ENERGY] > 0) {
            removeBuilderEnergyRequest(creep.name);
        }

        // Энергии нет
        if (creep.store[RESOURCE_ENERGY] === 0) {

            if (hasCarrier) {
                // Проверяем, закреплён ли за строителем живой перевозчик
                const carrierName = creep.memory.energyDeliveryCarrier;
                const carrier = carrierName
                    ? Game.creeps[carrierName]
                    : null;

                if (
                    carrier &&
                    carrier.memory.builderDeliveryTarget === creep.name
                ) {
                    removeBuilderEnergyRequest(creep.name);
                    releaseEnergyReservation(creep);
                    return;
                }

                // Закрепление устарело: перевозчик мог погибнуть
                if (carrierName) {
                    delete creep.memory.energyDeliveryCarrier;
                }

                // Оставляем заявку и ждём доставки
                requestBuilderEnergy(creep);
                releaseEnergyReservation(creep);
                return;
            }

            // Перевозчиков нет — используем прежний режим
            removeBuilderEnergyRequest(creep.name);

            const roomNames = [
                creep.room.name,
                homeRoom.name,
                ...remoteRooms
            ];

            let energyContainer = creep.memory.energyReservationTargetId
                ? Game.getObjectById(
                    creep.memory.energyReservationTargetId
                )
                : null;

            if (
                !energyContainer ||
                !energyContainer.store ||
                energyContainer.store[RESOURCE_ENERGY] === 0
            ) {
                releaseEnergyReservation(creep);

                const neededEnergy =
                    creep.store.getCapacity(RESOURCE_ENERGY);

                energyContainer = findEnergyContainer(
                    creep,
                    roomNames,
                    neededEnergy
                );

                if (!energyContainer) return;

                const reserved = getReservedEnergy(
                    energyContainer.id,
                    creep.name
                );

                const available =
                    energyContainer.store[RESOURCE_ENERGY] - reserved;

                if (available <= 0) return;

                reserveEnergy(
                    creep,
                    energyContainer,
                    Math.min(neededEnergy, available)
                );
            }

            const result = creep.withdraw(
                energyContainer,
                RESOURCE_ENERGY,
                creep.memory.energyReservationAmount
            );

            if (result === ERR_NOT_IN_RANGE) {
                creep.moveTo(energyContainer, {
                    range: 1,
                    reusePath: 20
                });
            } else if (
                result === OK ||
                result === ERR_NOT_ENOUGH_RESOURCES ||
                result === ERR_INVALID_TARGET
            ) {
                releaseEnergyReservation(creep);
            }

            return;
        }

        // Если Storage уже построен, строитель больше не обслуживает рампарт
        if (homeRoom.storage) {
            delete creep.memory.storageRampartRepairId;
        }

        // Ищем площадку Storage только пока он не построен
        const storageSite = homeRoom.storage
            ? null
            : homeRoom.find(
                FIND_MY_CONSTRUCTION_SITES,
                {
                    filter: site =>
                        site.structureType === STRUCTURE_STORAGE
                }
            )[0];

        if (storageSite) {

            // Ищем рампарт на той же клетке, что и Storage
            const rampart = homeRoom.lookForAt(
                LOOK_STRUCTURES,
                storageSite.pos.x,
                storageSite.pos.y
            ).find(structure =>
                structure.structureType === STRUCTURE_RAMPART &&
                structure.my
            );

            if (rampart) {

                // Запоминаем рампарт, который нужно защищать
                creep.memory.storageRampartRepairId = rampart.id;

                // Пока прочность меньше 1000, строительство не продолжаем
                if (rampart.hits < 1000) {

                    const result = creep.repair(rampart);

                    if (result === ERR_NOT_IN_RANGE) {
                        creep.moveTo(rampart, {
                            range: 3,
                            reusePath: 5
                        });
                    }

                    return;
                }

            } else {
                // Рампарт больше не существует
                delete creep.memory.storageRampartRepairId;
            }

        } else {
            // Площадки Storage больше нет
            delete creep.memory.storageRampartRepairId;
        }

        // Проверяем ранее выбранную строительную площадку
        let targetSite = creep.memory.buildTargetId
            ? Game.getObjectById(creep.memory.buildTargetId)
            : null;

        // Если площадка исчезла или строительство завершено,
        // выбираем новую
        if (
            !targetSite ||
            targetSite.progress >= targetSite.progressTotal
        ) {
            delete creep.memory.buildTargetId;
            targetSite = null;

            // Сначала домашняя комната, затем удалённые
            const roomNames = [
                homeRoom.name,
                ...remoteRooms
            ];

            for (const roomName of [...new Set(roomNames)]) {
                const room = Game.rooms[roomName];

                if (!room) continue;

                const sites = room.find(FIND_MY_CONSTRUCTION_SITES);

                for (const site of sites) {

                    // Проверяем, не закреплена ли площадка
                    // за другим строителем
                    const assignedToOtherBuilder =
                        Object.values(Game.creeps).some(
                            otherCreep =>
                                otherCreep.name !== creep.name &&
                                otherCreep.memory.role === "builder" &&
                                otherCreep.memory.buildTargetId === site.id
                        );

                    if (assignedToOtherBuilder) continue;

                    // Назначаем свободную площадку
                    targetSite = site;
                    creep.memory.buildTargetId = site.id;
                    break;
                }

                if (targetSite) break;
            }
        }

        // Подходящих площадок нет
        if (!targetSite) {
            removeBuilderEnergyRequest(creep.name);
            return;
        }

        // Если строитель находится на границе комнаты,
        // сначала отходим к центру комнаты
        if (
            creep.room.name === targetSite.room.name &&
            (
                creep.pos.x === 0 ||
                creep.pos.x === 49 ||
                creep.pos.y === 0 ||
                creep.pos.y === 49
            )
        ) {
            creep.moveTo(
                new RoomPosition(25, 25, creep.room.name),
                {
                    reusePath: 0
                }
            );

            return;
        }

        // Строитель занимается строительством
        const result = creep.build(targetSite);

        // Если площадка слишком далеко — движемся к ней
        if (result === ERR_NOT_IN_RANGE) {
            creep.moveTo(targetSite, {
                reusePath: 5,
                maxRooms: 16
            });
        }
    }
};