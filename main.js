const military = require("military");
const reserver = require("reserver");
const advancedUpgrader = require("advancedUpgrader");
//логика размещения строений
const construction = require("construction");

const DESIRED_UPGRADERS = 2;
//const DESIRED_BUILDERS = 1; // строитель теперь зависит от того есть ли строительная площадка
// Количество необходимых ремонтников
// const repairerCount = 1; теперь зависит от того есть ли что чинить (хотябы 1 контейнер)
const DESIRED_CARRIERS = 2; // Перевозчик
const MAX_TOWER_DELIVERY_CARRIERS = 0; // максимальное кол-во задействованных перевозчиков для доставки энергии к башне
const TOWER_WALL_TARGET_HITS = 100000;

// Доля средней прочности, при которой укрепление считается критическим
const TOWER_CRITICAL_RATIO = 0.8;

// Башня и закреплённые за ней контейнеры
const TOWER_ID = null;
const TOWER_CONTAINER_IDS = [];
// Комнаты, разрешённые для освоения
const REMOTE_ROOMS = [
];
const REMOTE_ROOM = REMOTE_ROOMS[0]; // Временно для старых функций

const CREEP_BODY = [WORK, CARRY, MOVE];

// Тело обслуживающего башню
const TOWER_SUPPORT_BODY = [
    CARRY,
    CARRY,
    WORK,
    MOVE,
    MOVE,
    MOVE
];

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

// Тела строителей по поколениям Extensions

const BUILDER_BODY_Version_0 = [
    WORK, CARRY, MOVE
];

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
// Тело разведчика
const SCOUT_BODY = [MOVE];

// Тела перевозчиков по поколениям Extensions

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
// Тела для строителей
const MINER_BODY_Version_1 = [
    WORK, WORK, 
    MOVE, MOVE
]; // 350 энергии

const MINER_BODY_Version_4 = [
    WORK, WORK, WORK, WORK,
    MOVE, MOVE
]; // 500 энергии

const MINER_BODY_Version_6 = [
    WORK, WORK, WORK, WORK, WORK,
    MOVE, MOVE
]; // 600 энергии

const MINER_BODY_Version_9 = [
    WORK, WORK, WORK, WORK, WORK, WORK,
    MOVE, MOVE, MOVE
];

// Создание крипов
function manageSpawning(spawn) {
    if (spawn.spawning) return;

    const creeps = Object.values(Game.creeps);

    const countRole = role =>
        creeps.filter(creep => creep.memory.role === role).length;



    // Проверяем, есть ли контейнеры в домашней или удалённых комнатах
    const repairRoomNames = [
        spawn.room.name,
        ...REMOTE_ROOMS
    ];

    const hasContainers = [
        ...new Set(repairRoomNames)
    ].some(roomName => {
        const room = Game.rooms[roomName];

        if (!room) return false;

        return room.find(FIND_STRUCTURES, {
            filter: structure =>
                structure.structureType === STRUCTURE_CONTAINER
        }).length > 0;
    });

    // Проверяем, построен ли Storage в домашней комнате
    const hasStorage = spawn.room.find(FIND_MY_STRUCTURES, {
        filter: structure =>
            structure.structureType === STRUCTURE_STORAGE
    }).length > 0;

    // Проверяем наличие действующего шахтёра
    const hasActiveMiner = creeps.some(creep =>
        creep.memory.role === "miner" &&
        !creep.spawning
    );

    // Определяем, разрешено ли создавать перевозчиков
    const carrierCount = (
        hasStorage ||
        (hasContainers && hasActiveMiner)
    )
        ? DESIRED_CARRIERS
        : 0;

    // До появления первого контейнера ремонтник не нужен
    const repairerCount = hasContainers ? 1 : 0;

    // Проверяем наличие башни
    const hasTower = !!Game.getObjectById(TOWER_ID);

    // Проверяем наличие хотя бы одного закреплённого контейнера
    const hasTowerContainer = TOWER_CONTAINER_IDS.some(id => {
        const container = Game.getObjectById(id);

        return container &&
            container.structureType === STRUCTURE_CONTAINER;
    });

    // Обслуживающий башню крип нужен только при наличии башни и контейнера
    const towerSupportCount =
        hasTower && hasTowerContainer ? 1 : 0;

    // Проверяем действующих обслуживающих башню крипов
    const towerSupports = creeps.filter(creep =>
        creep.memory.role === "towerSupport"
    );

    // Проверяем, нужна ли плановая замена
    const towerSupportNeedsReplacement = towerSupports.some(creep =>
        !creep.spawning &&
        creep.ticksToLive !== undefined &&
        creep.ticksToLive <= 300
    );

    // Создаём замену, если старый крип скоро умрёт
    const desiredTowerSupports =
        hasTower && hasTowerContainer
            ? (towerSupports.length === 0 ||
                (towerSupportNeedsReplacement &&
                    towerSupports.length === 1)
                ? 1
                : towerSupports.length)
            : 0;

    // Проверяем, построен ли хотя бы один Extension
    const extensions = spawn.room.find(FIND_MY_STRUCTURES, {
        filter: structure =>
            structure.structureType === STRUCTURE_EXTENSION
    });
    // Выбор тела Апгрейдера в зависимости от кол-ва Расширителей

    let upgraderBody;

    if (extensions.length >= 7) {
        upgraderBody = UPGRADER_BODY_Version_7;
    } else if (extensions.length >= 5) {
        upgraderBody = UPGRADER_BODY_Version_5;
    } else if (extensions.length >= 2) {
        upgraderBody = UPGRADER_BODY_Version_2;
    } else {
        upgraderBody = UPGRADER_BODY_Version_0;
    }

    // Количество необходимых строителей

    // Проверяем, есть ли строительные площадки
    const constructionRoomNames = [
        spawn.room.name,
        ...REMOTE_ROOMS
    ];

    const hasConstructionSitesForBuilder =
        [...new Set(constructionRoomNames)].some(roomName => {
            const room = Game.rooms[roomName];

            if (!room) return false;

            return room.find(FIND_MY_CONSTRUCTION_SITES).length > 0;
        });

    // Строитель нужен только при наличии площадок и только если есть контейнер

    const builderCount =
        hasContainers && hasConstructionSitesForBuilder ? 1 : 0;



    // Выбираем поколение строителя по количеству Extensions
    let builderBody;
    if (extensions.length >= 8) {
        builderBody = BUILDER_BODY_Version_8;
    } else if (extensions.length >= 5) {
        builderBody = BUILDER_BODY_Version_5;
    } else if (extensions.length >= 2) {
        builderBody = BUILDER_BODY_Version_2;
    } else {
        builderBody = BUILDER_BODY_Version_0;
    }


    // Выбираем поколение перевозчика
    let carrierBody;

    // Если перевозчиков ещё нет — создаём базовую версию
    if (countRole("carrier") === 0) {
        carrierBody = CARRIER_BODY_Version_0;
    } else if (extensions.length >= 8) {
        carrierBody = CARRIER_BODY_Version_8;
    } else if (extensions.length >= 5) {
        carrierBody = CARRIER_BODY_Version_5;
    } else if (extensions.length >= 2) {
        carrierBody = CARRIER_BODY_Version_2;
    } else {
        carrierBody = CARRIER_BODY_Version_0;
    }



    // Выбор поколения шахтёра по количеству построенных Extensions
    let minerBody;

    if (extensions.length >= 9) {
        minerBody = MINER_BODY_Version_9;
    } else if (extensions.length >= 6) {
        minerBody = MINER_BODY_Version_6;
    } else if (extensions.length >= 4) {
        minerBody = MINER_BODY_Version_4;
    } else {
        minerBody = MINER_BODY_Version_1;
    }

    const mines = calculateMineNeeds(spawn.room);

    const allMines = calculateAllMineNeeds(spawn.room);

    const desiredHarvesters = allMines.reduce(
        (total, mine) => total + mine.desiredHarvesters,
        0
    );

    const eligibleMines = allMines.filter(
        mine => mine.desiredMiners > 0 && mine.level >= 2
    );

    const controllerContainerExists =
        !!advancedUpgrader.findControllerContainer(spawn.room);

    const desiredUpgraders =
    !hasContainers ||
        (controllerContainerExists && extensions.length > 17)
        ? 0
        : extensions.length === 0
            ? 1
            : 2;

    // Приоритет создания
    const roles = [
        {
            role: "carrier",
            desired: carrierCount,
            prefix: "Carrier",
            body: carrierBody
        },
        {
            role: "harvester",
            desired: desiredHarvesters,
            prefix: "Harvester",
            body: CREEP_BODY
        },
        {
            role: "upgrader",
            //desired: DESIRED_UPGRADERS,
            desired: desiredUpgraders,
            prefix: "Upgrader",
            body: upgraderBody
        },
        {
            role: "builder",
            desired: builderCount,
            prefix: "Builder",
            body: builderBody
        },
        {
            role: "repairer",
            desired: repairerCount,
            prefix: "Repairer",
            body: builderBody
        },
        {
            role: "towerSupport",
            desired: desiredTowerSupports,
            prefix: "TowerSupport",
            body: TOWER_SUPPORT_BODY
        }
    ];



    // Проверяем потребность в шахтёрах отдельно для каждой шахты
    const assignedMiners = Object.values(Game.creeps)
        .filter(creep => creep.memory.role === "miner");

    for (const mine of eligibleMines) {
        const minersOnMine = assignedMiners.filter(creep =>
            creep.memory.mineId === mine.id &&
            (creep.memory.mineRoomName || creep.memory.targetRoom) === mine.roomName
        );

        // Не создаём третьего шахтёра для одной шахты
        if (minersOnMine.length > mine.desiredMiners + 1) continue;

        // Проверяем, заканчивается ли жизнь действующего шахтёра
        const minerNeedsReplacement = minersOnMine.some(creep =>
            !creep.spawning &&
            creep.ticksToLive !== undefined &&
            creep.ticksToLive <= 300
        );

        // Если шахтёров уже достаточно, создаём дополнительного
        // только тогда, когда старый скоро умрёт
        if (minersOnMine.length >= mine.desiredMiners) {
            if (!minerNeedsReplacement) continue;

            // Если дополнительный шахтёр уже появился,
            // повторно его не создаём
            if (minersOnMine.length > mine.desiredMiners) continue;
        }

        const cost = minerBody.reduce(
            (total, part) => total + BODYPART_COST[part],
            0
        );

        if (spawn.room.energyAvailable < cost) break;

        const name = "Miner_" + Game.time;

        const result = spawn.spawnCreep(
            minerBody,
            name,
            {
                memory: {
                    role: "miner",
                    working: false,
                    mineId: mine.id,
                    mineRoomName: mine.roomName,
                    targetRoom: mine.roomName
                }
            }
        );

        if (result === OK) {
            console.log(
                "[ШАХТЁР] Создаём шахтёра для шахты:",
                mine.id,
                minerNeedsReplacement
                    ? "— плановая замена"
                    : "— обычное создание"
            );
        }

        return;
    }


    for (const item of roles) {
        const currentCount = item.role === "harvester"
            ? countRole("harvester") + countRole("remoteHarvester")
            : countRole(item.role);

        if (currentCount >= item.desired) continue;

        const cost = item.body.reduce(
            (total, part) => total + BODYPART_COST[part],
            0
        );

        // Если энергии пока недостаточно, проверяем следующую роль
        if (spawn.room.energyAvailable < cost) continue;

        const name = item.prefix + "_" + Game.time;

        const memory = {
            role: item.role,
            working: false
        };

        const result = spawn.spawnCreep(
            item.body,
            name,
            { memory }
        );

        if (result === OK) {
            console.log("Создаём крипа:", name, "роль:", item.role);
        }

        return;
    }


    // Разведка удалённых комнат
    for (const roomName of REMOTE_ROOMS) {

        // Комната уже видна — разведчик не нужен
        if (Game.rooms[roomName]) continue;

        // Проверяем, не создан ли уже разведчик для этой комнаты
        const scoutExists = creeps.some(creep =>
            creep.memory.role === "scout" &&
            creep.memory.scoutRoomName === roomName
        );

        if (scoutExists) continue;

        // Для разведчика достаточно 50 энергии
        const name = "Scout_" + roomName + "_" + Game.time;

        const result = spawn.spawnCreep(
            SCOUT_BODY,
            name,
            {
                memory: {
                    role: "scout",
                    scoutRoomName: roomName
                }
            }
        );

        if (result === OK) {
            console.log(
                "[РАЗВЕДЧИК] Отправляем в комнату:",
                roomName
            );
        }

        // За один вызов создаём не более одного разведчика
        return;
    }

}

// Переключение между добычей и работой
function updateWorkingState(creep) {
    if (creep.store[RESOURCE_ENERGY] === 0) {
        creep.memory.working = false;
    }

    if (creep.store.getFreeCapacity() === 0) {
        creep.memory.working = true;
    }
}


// Добыча энергии из назначенной шахты
function harvestEnergy(creep) {
    const source = creep.memory.mineId
        ? Game.getObjectById(creep.memory.mineId)
        : null;

    if (!source) return;

    const result = creep.harvest(source);

    if (result === ERR_NOT_IN_RANGE) {
        creep.moveTo(source);
    }
}

// Передача энергии или строительство

function deliverEnergy(creep, spawn, containers, site) {
    // 1. Сначала заполняем Spawn
    if (spawn.store.getFreeCapacity(RESOURCE_ENERGY) > 0) {
        const result = creep.transfer(spawn, RESOURCE_ENERGY);
        if (result === ERR_NOT_IN_RANGE) creep.moveTo(spawn);
        return;
    }

    // 2. Затем заполняем Extensions
    const extensions = spawn.room.find(FIND_MY_STRUCTURES, {
        filter: structure =>
            structure.structureType === STRUCTURE_EXTENSION &&
            structure.store.getFreeCapacity(RESOURCE_ENERGY) > 0
    });

    if (extensions.length > 0) {
        const extension = creep.pos.findClosestByRange(extensions);
        const result = creep.transfer(extension, RESOURCE_ENERGY);
        if (result === ERR_NOT_IN_RANGE) creep.moveTo(extension);
        return;
    }

    // 3. Затем складываем энергию в контейнеры
    const container = containers.find(
        structure => structure.store.getFreeCapacity(RESOURCE_ENERGY) > 0
    );

    if (container) {
        const result = creep.transfer(container, RESOURCE_ENERGY);
        if (result === ERR_NOT_IN_RANGE) creep.moveTo(container, { range: 1 }); // не занимать клетку с контейнером
        return;
    }

    // 4. Если хранить энергию больше негде — строим
    if (site) {
        const result = creep.build(site);
        if (result === ERR_NOT_IN_RANGE) creep.moveTo(site);
    }
}


// Обычный добытчик

function runHarvester(creep, spawn, containers, site) {
    updateWorkingState(creep);

    const homeRoom = spawn.room;
    const mineId = creep.memory.mineId;
    const mineRoomName = creep.memory.mineRoomName || homeRoom.name;

    // Если у добытчика ещё нет назначения
    if (!mineId) {
        console.log(
            "[ДОБЫТЧИК] Нет назначения:",
            creep.name
        );
        return;
    }

    // Режим добычи
    if (!creep.memory.working) {

        // Добираемся до комнаты своей шахты
        if (creep.room.name !== mineRoomName) {
            creep.moveTo(
                new RoomPosition(25, 25, mineRoomName),
                { reusePath: 20 }
            );
            return;
        }

        // Получаем именно свой источник, а не ближайший
        const source = Game.getObjectById(mineId);

        if (!source) {
            console.log(
                "[ДОБЫТЧИК] Не найден источник:",
                creep.name,
                mineId,
                "Комната:",
                mineRoomName
            );
            return;
        }

        const result = creep.harvest(source);

        if (result === ERR_NOT_IN_RANGE) {
            creep.moveTo(source, { reusePath: 20 });
        }

        return;
    }

    // Режим доставки: возвращаемся на домашнюю базу
    if (creep.room.name !== homeRoom.name) {
        creep.moveTo(spawn, { reusePath: 20 });
        return;
    }

    // Сдаём энергию на домашней базе
    deliverEnergy(creep, spawn, containers, site);
}




// Улучшатель контроллера
function runUpgrader(creep, homeRoom, containers) {
    updateWorkingState(creep);

    const energy = creep.store[RESOURCE_ENERGY];

    // Если энергия уже получена, освобождаем резерв
    if (energy > 0) {
        releaseEnergyReservation(creep);
    }

    // Если энергии нет — ищем контейнер с учётом резервов
    if (energy === 0) {
        let container = creep.memory.energyReservationTargetId
            ? Game.getObjectById(
                creep.memory.energyReservationTargetId
            )
            : null;

        // Проверяем сохранённую цель
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

        // При успешном получении сохраняем резерв до следующего тика
        return;
    }

    // Улучшаем домашний контроллер
    const controller = homeRoom.controller;

    if (!controller) return;

    const result = creep.upgradeController(controller);

    if (result === ERR_NOT_IN_RANGE) {
        creep.moveTo(controller);
    }
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

// Снимаем закрепление перевозчика за строителем
function clearBuilderEnergyAssignment(carrier) {
    const builderName = carrier.memory.builderDeliveryTarget;
    const builder = builderName ? Game.creeps[builderName] : null;

    if (
        builder &&
        builder.memory.energyDeliveryCarrier === carrier.name
    ) {
        delete builder.memory.energyDeliveryCarrier;
    }

    delete carrier.memory.builderDeliveryTarget;

    releaseEnergyReservation(carrier);
}

// Обработка отдельного режима доставки строителю

function runBuilderDeliveryMode(carrier, homeRoom) {
    const builderName = carrier.memory.builderDeliveryTarget;
    const builder = builderName ? Game.creeps[builderName] : null;

    // Строитель погиб или больше не является строителем
    if (!builder || builder.memory.role !== "builder") {
        clearBuilderEnergyAssignment(carrier);
        return false;
    }

    // Проверяем, остались ли строительные площадки
    const roomNames = [homeRoom.name, ...REMOTE_ROOMS];

    const hasConstructionSites = [...new Set(roomNames)].some(
        roomName => {
            const room = Game.rooms[roomName];

            return room &&
                room.find(FIND_MY_CONSTRUCTION_SITES).length > 0;
        }
    );

    if (!hasConstructionSites) {
        clearBuilderEnergyAssignment(carrier);
        return false;
    }

    // Энергия закончилась — открепляемся и возвращаемся на базу
    if (carrier.store[RESOURCE_ENERGY] === 0) {
        clearBuilderEnergyAssignment(carrier);
        carrier.memory.working = false;
        carrier.memory.returningToBase = true;
        return false;
    }


    // Доставляем энергию закреплённому строителю
    const result = carrier.transfer(builder, RESOURCE_ENERGY);

    if (result === ERR_NOT_IN_RANGE) {
        carrier.moveTo(builder, {
            range: 1,
            reusePath: 20
        });
    } else if (result === ERR_INVALID_TARGET) {
        clearBuilderEnergyAssignment(carrier);
        return false;
    }


    // Если передача опустошила перевозчика, начинаем возвращение
    if (carrier.store[RESOURCE_ENERGY] === 0) {
        clearBuilderEnergyAssignment(carrier);
        carrier.memory.working = false;
        carrier.memory.returningToBase = true;
    }

    return true;
}


function runBuilder(creep, spawn, homeRoom) {
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

        // Перевозчиков нет — сохраняем прежний режим
        removeBuilderEnergyRequest(creep.name);

        const roomNames = [
            creep.room.name,
            homeRoom.name,
            ...REMOTE_ROOMS
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
            ...REMOTE_ROOMS
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
    // в которой расположена строительная площадка,
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

// Шахтёр поиск назначенного источника

// Шахтёр — поиск назначенного источника

// Шахтёр — поиск назначенного источника
function runMiner(creep, homeRoom) {
    const mine = creep.memory.mineId
        ? Game.getObjectById(creep.memory.mineId)
        : null;

    if (!mine) return;

    const room = mine.room;
    if (!room) return;

    // Временный режим: разбор лишнего контейнера
    const dismantleId = creep.memory.dismantleContainerId;

    if (dismantleId) {
        const target = Game.getObjectById(dismantleId);

        // Контейнер уже уничтожен — возвращаемся к добыче
        if (!target) {
            delete creep.memory.dismantleContainerId;
        } else {
            // Разбираем только контейнер возле своего источника
            const nearbyContainers = mine.pos.findInRange(
                FIND_STRUCTURES,
                1,
                {
                    filter: structure =>
                        structure.structureType === STRUCTURE_CONTAINER
                }
            );

            // Последний контейнер шахты не трогаем
            if (
                target.structureType !== STRUCTURE_CONTAINER ||
                target.pos.roomName !== room.name ||
                target.pos.getRangeTo(mine) > 1 ||
                nearbyContainers.length <= 1
            ) {
                delete creep.memory.dismantleContainerId;
            } else {
                const result = creep.dismantle(target);

                if (result === ERR_NOT_IN_RANGE) {
                    creep.moveTo(target, {
                        range: 1,
                        reusePath: 20
                    });
                }

                // Пока контейнер разбирается, добычу не выполняем
                return;
            }
        }
    }

    const containers = mine.pos.findInRange(
        FIND_STRUCTURES,
        1,
        {
            filter: structure =>
                structure.structureType === STRUCTURE_CONTAINER
        }
    );

    if (containers.length === 0) return;

    // Сначала ищем контейнер, на котором стоит шахтёр
    let container = containers.find(c =>
        creep.pos.isEqualTo(c.pos)
    );

    // Если текущий контейнер заполнен,
    // ищем другой контейнер со свободным местом
    if (
        container &&
        container.store.getFreeCapacity(RESOURCE_ENERGY) === 0
    ) {
        container = containers.find(c =>
            !creep.pos.isEqualTo(c.pos) &&
            c.store.getFreeCapacity(RESOURCE_ENERGY) > 0
        );
    }

    // Если шахтёр ещё не стоит на выбранном контейнере
    if (!container) {
        container = containers.find(c =>
            c.store.getFreeCapacity(RESOURCE_ENERGY) > 0
        );
    }

    // Если все контейнеры заполнены — ждём
    if (!container) return;

    // Переходим к выбранному контейнеру
    if (!creep.pos.isEqualTo(container.pos)) {
        creep.moveTo(container);
        return;
    }

    // Добываем энергию
    creep.harvest(mine);
}


// Ремонтник: проверка контейнеров по очереди
function runRepairer(creep, homeRoom) {
    // Проверяем, существует ли обслуживающий башню крип
    const hasTowerSupport = Object.values(Game.creeps).some(
        other => other.memory.role === "towerSupport"
    );
    // 1. Если энергия закончилась — пополняемся
    if (creep.store[RESOURCE_ENERGY] === 0) {

        const roomNames = [
            creep.room.name,
            homeRoom.name,
            ...REMOTE_ROOMS
        ];

        let energyContainer = creep.memory.energyReservationTargetId
            ? Game.getObjectById(
                creep.memory.energyReservationTargetId
            )
            : null;

        // Если зарезервированный контейнер исчез
        //if (!energyContainer) {
        // Если зарезервированная структура исчезла
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

            reserveEnergy(
                creep,
                energyContainer,
                neededEnergy
            );
        }

        const result = creep.withdraw(
            energyContainer,
            RESOURCE_ENERGY
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

    // 2. Если ремонт уже начат — продолжаем его
    const repairTarget = creep.memory.repairTargetId
        ? Game.getObjectById(creep.memory.repairTargetId)
        : null;

    if (repairTarget) {
        // Если башню обслуживает towerSupport,
        // обычный ремонтник пропускает её и её контейнеры
        if (
            hasTowerSupport &&
            (
                repairTarget.id === TOWER_ID ||
                TOWER_CONTAINER_IDS.includes(repairTarget.id)
            )
        ) {
            delete creep.memory.repairTargetId;
        } else {

            // Не ремонтируем контейнер, назначенный на разбор
            const assignedForDismantle = Object.values(Game.creeps).some(
                miner =>
                    miner.memory.role === "miner" &&
                    miner.memory.dismantleContainerId === repairTarget.id
            );

            if (assignedForDismantle) {
                delete creep.memory.repairTargetId;
            } else {

                // Продолжаем ремонт, пока контейнер не восстановлен
                if (repairTarget.hits < repairTarget.hitsMax) {
                    const result = creep.repair(repairTarget);

                    if (result === ERR_NOT_IN_RANGE) {
                        creep.moveTo(repairTarget, {
                            reusePath: 20
                        });
                    }

                    return;
                }

                // Контейнер восстановлен — снимаем паузу
                delete creep.memory.repairTargetId;
            }
        }
    }

    // 3. Собираем контейнеры в фиксированном порядке:
    // сначала домашняя комната, затем удалённые
    const roomNames = [
        homeRoom.name,
        ...REMOTE_ROOMS
    ];

    const containers = [];

    for (const roomName of [...new Set(roomNames)]) {
        const room = Game.rooms[roomName];

        // Пропускаем невидимые комнаты
        if (!room) continue;

        // список объектов, попадающих под ремонт
        const roomContainers = room.find(FIND_STRUCTURES, {
            filter: structure => {
                if (
                    structure.structureType !== STRUCTURE_CONTAINER &&
                    structure.structureType !== STRUCTURE_STORAGE
                ) {
                    return false;
                }

                // Башню и её контейнеры обслуживает towerSupport
                if (
                    hasTowerSupport &&
                    (
                        structure.id === TOWER_ID ||
                        TOWER_CONTAINER_IDS.includes(structure.id)
                    )
                ) {
                    return false;
                }

                // Пропускаем контейнеры, назначенные на разбор
                if (
                    structure.structureType === STRUCTURE_CONTAINER &&
                    Object.values(Game.creeps).some(miner =>
                        miner.memory.role === "miner" &&
                        miner.memory.dismantleContainerId === structure.id
                    )
                ) {
                    return false;
                }

                return true;
            }
        });

        containers.push(...roomContainers);
    }

    if (containers.length === 0) {
        creep.memory.repairCheckIndex = 0;
        return;
    }

    // 4. Выбираем контейнер для проверки
    let index = creep.memory.repairCheckIndex || 0;

    if (index >= containers.length) {
        index = 0;
    }

    const container = containers[index];

    // Сразу запоминаем, какой контейнер проверять следующим
    creep.memory.repairCheckIndex =
        (index + 1) % containers.length;

    // 5. Проверяем контейнер без перемещения к нему
    if (container.hits < container.hitsMax) {

        // Приостанавливаем очередь до полного ремонта
        creep.memory.repairTargetId = container.id;

        const result = creep.repair(container);

        if (result === ERR_NOT_IN_RANGE) {
            creep.moveTo(container, {
                reusePath: 20
            });
        }

        return;
    }

    // Контейнер исправен — в следующем тике проверится следующий
}

// Разведчик
function runScout(creep) {
    const targetRoomName = creep.memory.scoutRoomName;
    if (!targetRoomName) return;
    // Достиг цели — остаёмся в комнате
    if (creep.room.name === targetRoomName) {
        return;
    }
    // Направляемся в нужную комнату
    creep.moveTo(
        new RoomPosition(25, 25, targetRoomName),
        { reusePath: 20 }
    );
}

// РЕЖИМ РАБОТЫ БАШНИ - МИРНЫЙ

// Мирное укрепление самых слабых стен и рампартов
function repairTowerDefenses() {
    const tower = Game.getObjectById(TOWER_ID);

    if (!tower) return;

    // Башне нужно минимум 10 единиц энергии
    if (tower.store[RESOURCE_ENERGY] < 10) return;

    // Ищем только стены и рампарты ниже целевой прочности
    const targets = tower.room.find(FIND_STRUCTURES, {
        filter: structure =>
            (
                structure.structureType === STRUCTURE_WALL ||
                structure.structureType === STRUCTURE_RAMPART
            ) &&
            structure.hits < TOWER_WALL_TARGET_HITS
    });

    // Все укрепления достигли целевой прочности
    if (targets.length === 0) return;

    // В первую очередь укрепляем самый слабый объект
    targets.sort((a, b) => a.hits - b.hits);

    tower.repair(targets[0]);
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


// Общая логика резервирования энергии

// Сколько энергии уже зарезервировано другими юнитами
function getReservedEnergy(containerId, creepName) {
    return Object.values(Game.creeps)
        .filter(creep =>
            creep.name !== creepName &&
            creep.memory.energyReservationTargetId === containerId
        )
        .reduce(
            (total, creep) =>
                total + (creep.memory.energyReservationAmount || 0),
            0
        );
}


// Поиск контейнера или Storage с учётом резервов
function findEnergyContainer(
    creep,
    roomNames,
    neededEnergy,
    allowStorage = true,
    storageFirst = false
) {    // Сначала проверяем контейнеры, затем Storage
    const structureTypes = allowStorage
        ? (
            storageFirst
                ? [STRUCTURE_STORAGE, STRUCTURE_CONTAINER]
                : [STRUCTURE_CONTAINER, STRUCTURE_STORAGE]
        )
        : [STRUCTURE_CONTAINER];

    for (const structureType of structureTypes) {
        for (const roomName of [...new Set(roomNames)]) {
            const room = Game.rooms[roomName];

            // Работаем только с видимыми комнатами
            if (!room) continue;

            const structures = room.find(FIND_STRUCTURES, {
                filter: structure =>
                    structure.structureType === structureType &&
                    structure.store[RESOURCE_ENERGY] > 0
            });

            for (const structure of structures) {

                // Контейнеры башни доступны только towerSupport
                if (
                    structure.structureType === STRUCTURE_CONTAINER &&
                    TOWER_CONTAINER_IDS.includes(structure.id) &&
                    creep.memory.role !== "towerSupport"
                ) {
                    continue;
                }

                const reserved = getReservedEnergy(
                    structure.id,
                    creep.name
                );

                const available =
                    structure.store[RESOURCE_ENERGY] - reserved;

                if (available < neededEnergy) continue;

                return structure;
            }
        }
    }

    return null;
}


function runTowerContainerDeliveryMode(creep, homeRoom) {
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

        const reserved = getReservedEnergy(storage.id, creep.name);
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
            reserveEnergy(creep, storage, deliveryAmount);

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
        releaseEnergyReservation(creep);
        delete creep.memory.towerDeliveryTargetId;
        delete creep.memory.towerDeliverySourceId;
        delete creep.memory.towerDeliveryAmount;
        delete creep.memory.towerDeliveryActive;
        return false;
    }

    // ФАЗА 1: забираем из Storage строго согласованный объём
    if (creep.store[RESOURCE_ENERGY] === 0) {
        if (storage.store[RESOURCE_ENERGY] < amount) {
            releaseEnergyReservation(creep);
            delete creep.memory.towerDeliveryTargetId;
            delete creep.memory.towerDeliverySourceId;
            delete creep.memory.towerDeliveryAmount;
            delete creep.memory.towerDeliveryActive;
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
            releaseEnergyReservation(creep);
        } else if (
            result === ERR_NOT_ENOUGH_RESOURCES ||
            result === ERR_INVALID_TARGET
        ) {
            releaseEnergyReservation(creep);
            delete creep.memory.towerDeliveryTargetId;
            delete creep.memory.towerDeliverySourceId;
            delete creep.memory.towerDeliveryAmount;
            delete creep.memory.towerDeliveryActive;
        }

        return true;
    }

    // ФАЗА 2: выгружаем весь заказ в назначенный контейнер
    if (creep.store[RESOURCE_ENERGY] !== amount) {
        // Не смешиваем этот заказ с частичной загрузкой
        releaseEnergyReservation(creep);
        delete creep.memory.towerDeliveryTargetId;
        delete creep.memory.towerDeliverySourceId;
        delete creep.memory.towerDeliveryAmount;
        delete creep.memory.towerDeliveryActive;
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

        delete creep.memory.towerDeliveryTargetId;
        delete creep.memory.towerDeliverySourceId;
        delete creep.memory.towerDeliveryAmount;
        // После доставки возвращаемся к спавну
        creep.memory.returningToBase = true;

    } else if (
        result === ERR_NOT_ENOUGH_RESOURCES ||
        result === ERR_INVALID_TARGET
    ) {
        // Не удаляем заказ при временной ошибке:
        // следующий тик сможет повторить попытку
        if (result === ERR_INVALID_TARGET) {
            delete creep.memory.towerDeliveryTargetId;
            delete creep.memory.towerDeliverySourceId;
            delete creep.memory.towerDeliveryAmount;
            delete creep.memory.towerDeliveryActive;
        }
    }

    return true;
}

// доставка энергии до контейнера контролера
function runControllerContainerDeliveryMode(creep, homeRoom) {
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

        const reserved = getReservedEnergy(storage.id, creep.name);

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

        reserveEnergy(creep, storage, capacity);
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
        releaseEnergyReservation(creep);
        delete creep.memory.controllerDeliveryTargetId;
        delete creep.memory.controllerDeliverySourceId;
        delete creep.memory.controllerDeliveryAmount;
        return false;
    }

    // Фаза 1: забираем полную загрузку из Storage
    if (creep.store[RESOURCE_ENERGY] === 0) {
        if (storage.store[RESOURCE_ENERGY] < amount) {
            releaseEnergyReservation(creep);
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
            releaseEnergyReservation(creep);
        } else if (
            result === ERR_NOT_ENOUGH_RESOURCES ||
            result === ERR_INVALID_TARGET
        ) {
            releaseEnergyReservation(creep);
            delete creep.memory.controllerDeliveryTargetId;
            delete creep.memory.controllerDeliverySourceId;
            delete creep.memory.controllerDeliveryAmount;
            return false;
        }

        return true;
    }

    // Не смешиваем заказ с другой загрузкой
    if (creep.store[RESOURCE_ENERGY] !== amount) {
        releaseEnergyReservation(creep);
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
        releaseEnergyReservation(creep);
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
// Зарезервировать энергию в выбранном контейнере
function reserveEnergy(creep, container, amount) {
    creep.memory.energyReservationTargetId = container.id;
    creep.memory.energyReservationAmount = amount;
}

// Освободить резерв энергии
function releaseEnergyReservation(creep) {
    delete creep.memory.energyReservationTargetId;
    delete creep.memory.energyReservationAmount;
}

// Поведение перевозчика
function runCarrier(creep, spawn, homeRoom) {


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
        releaseEnergyReservation(creep);
    };

    // Полный перевозчик переключается на доставку
    if (freeCapacity === 0) {
        creep.memory.working = true;
    }

    if (creep.store[RESOURCE_ENERGY] === 0) {
        creep.memory.working = false;
    }

    // Если перевозчик уже закреплён за строителем,
    // сначала продолжаем специальную доставку
    if (creep.memory.builderDeliveryTarget) {
        const handled = runBuilderDeliveryMode(
            creep,
            homeRoom
        );

        if (handled) return;
    }
    // Специальный режим доставки энергии в контейнер башни
    if (runTowerContainerDeliveryMode(creep, homeRoom)) {
        return;
    }

    // Специальный режим доставки энергии в контейнер контроллера
    if (runControllerContainerDeliveryMode(creep, homeRoom)) {
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

        // Приоритет 3: Строитель из очереди
        if (!target) {
            const builder = claimBuilderEnergyRequest(creep);

            if (builder) {
                runBuilderDeliveryMode(creep, homeRoom);
                return;
            }
        }

        // Приоритет 4: Storage
        if (
            !target
        ) {
            target = homeRoom.find(FIND_MY_STRUCTURES, {
                filter: structure =>
                    structure.structureType === STRUCTURE_STORAGE &&
                    structure.store.getFreeCapacity(RESOURCE_ENERGY) > 0
            })[0];
        }

        // Приоритет 5: контейнер возле контроллера
        if (!target) {
            const controllerContainer =
                advancedUpgrader.findControllerContainer(homeRoom);

            if (controllerContainer) {
                const capacity =
                    controllerContainer.store.getCapacity(RESOURCE_ENERGY);

                const energy =
                    controllerContainer.store[RESOURCE_ENERGY] || 0;

                const incomingEnergy = Object.values(Game.creeps)
                    .filter(other =>
                        other.name !== creep.name &&
                        other.memory.deliveryTargetId === controllerContainer.id
                    )
                    .reduce(
                        (sum, other) =>
                            sum + other.store[RESOURCE_ENERGY],
                        0
                    );

                if (
                    energy + incomingEnergy < capacity / 2 &&
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



        // Все приёмники заполнены
        // Если запас энергии меньше половины — отправляемся пополняться
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

    // ПРИОРИТЕТ: подобрать энергию после погибших крипов
    if (creep.store[RESOURCE_ENERGY] < capacity / 2) {

        // Освобождаем резерв контейнера:
        // теперь сначала проверяем оставленные ресурсы
        releaseReservation();

        const recoveryRoomNames = [
            creep.room.name,
            homeRoom.name,
            ...REMOTE_ROOMS
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
                const availableTombstones = tombstones.filter(tombstone =>
                    !Object.values(Game.creeps).some(other =>
                        other.name !== creep.name &&
                        other.memory.recoveryTargetId === tombstone.id
                    )
                );

                if (availableTombstones.length > 0) {
                    recoveryTarget = availableTombstones[0];
                    recoveryType = "tombstone";
                    creep.memory.recoveryTargetId = recoveryTarget.id;
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
                const availableDrops = droppedResources.filter(resource =>
                    !Object.values(Game.creeps).some(other =>
                        other.name !== creep.name &&
                        other.memory.recoveryTargetId === resource.id
                    )
                );

                if (availableDrops.length > 0) {
                    recoveryTarget = availableDrops[0];
                    recoveryType = "dropped";
                    creep.memory.recoveryTargetId = recoveryTarget.id;
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
    }

    // Если энергии уже половина или больше, новую не забираем
    if (creep.store[RESOURCE_ENERGY] >= capacity / 2) {
        releaseReservation();
        creep.memory.working = true;
        return;
    }

    const roomNames = [
        ...REMOTE_ROOMS,
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
    container = findEnergyContainer(
        creep,
        roomNames,
        neededEnergy,
        allowStorage,
        builderWaiting
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

// Установка контейнеров у источников
function manageContainerConstruction(room) {
    const sources = room.find(FIND_SOURCES);

    // Проверяем заполненность спавна и расширителей домашней базы
    const spawn = Game.spawns["Spawn1"];
    if (!spawn) return;

    const homeRoom = spawn.room;

    const spawnIsFull =
        spawn.store.getFreeCapacity(RESOURCE_ENERGY) === 0;

    const extensions = homeRoom.find(FIND_MY_STRUCTURES, {
        filter: structure =>
            structure.structureType === STRUCTURE_EXTENSION
    });

    const extensionsAreFull = extensions.every(extension =>
        extension.store.getFreeCapacity(RESOURCE_ENERGY) === 0
    );

    const homeIsFull = spawnIsFull && extensionsAreFull;

    for (const source of sources) {
        // Все контейнеры в соседних клетках источника
        const nearbyContainers = source.pos.findInRange(
            FIND_STRUCTURES,
            1,
            {
                filter: structure =>
                    structure.structureType === STRUCTURE_CONTAINER
            }
        );

        // Строящиеся контейнеры рядом с источником
        const nearbySites = source.pos.findInRange(
            FIND_CONSTRUCTION_SITES,
            1,
            {
                filter: site =>
                    site.structureType === STRUCTURE_CONTAINER
            }
        );

        // Если контейнера ещё нет — строим первый
        if (nearbyContainers.length === 0) {
            if (nearbySites.length > 0) continue;

            if (createMineContainer(room, source)) return;
            continue;
        }


        // Если контейнер уже строится, ждём его завершения
        if (nearbySites.length > 0) {
            continue;
        }

        // Все существующие контейнеры шахты должны быть заполнены
        const allContainersAreFull = nearbyContainers.every(
            container =>
                container.store.getFreeCapacity(RESOURCE_ENERGY) === 0
        );

        if (!allContainersAreFull) {
            continue;
        }

        // Домашняя база должна быть полностью заряжена
        if (!homeIsFull) continue;

        // Строим следующий контейнер рядом с источником
        if (createMineContainer(room, source)) {
            console.log(
                "[КОНТЕЙНЕР] Строим следующий контейнер у источника:",
                source.id,
                "Уже построено:",
                nearbyContainers.length
            );
            return;
        }

    }
}

// Поиск свободной соседней клетки для контейнера
function createMineContainer(room, source) {
    for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
            if (dx === 0 && dy === 0) continue;

            const x = source.pos.x + dx;
            const y = source.pos.y + dy;

            if (x < 0 || x > 49 || y < 0 || y > 49) {
                continue;
            }

            if (
                room.getTerrain().get(x, y) === TERRAIN_MASK_WALL
            ) continue;

            if (
                room.lookForAt(LOOK_STRUCTURES, x, y).length > 0 ||
                room.lookForAt(LOOK_CONSTRUCTION_SITES, x, y).length > 0 ||
                room.lookForAt(LOOK_SOURCES, x, y).length > 0 ||
                room.lookForAt(LOOK_MINERALS, x, y).length > 0
            ) continue;

            const result = room.createConstructionSite(
                x,
                y,
                STRUCTURE_CONTAINER
            );

            if (result === OK) {
                console.log(
                    "[КОНТЕЙНЕР] Создан у источника:",
                    source.id,
                    "позиция:",
                    x,
                    y
                );
                return true;
            }
        }
    }

    return false;
}

// мониторинг использования контейнеров
function monitorContainerIdleTime(homeRoom) {
    if (!Memory.containerIdleSince) {
        Memory.containerIdleSince = {};
    }

    if (!Memory.containerLastEnergy) {
        Memory.containerLastEnergy = {};
    }

    const roomNames = [...new Set([
        homeRoom.name,
        ...REMOTE_ROOMS
    ])];

    for (const roomName of roomNames) {
        const room = Game.rooms[roomName];
        if (!room) continue;

        const containers = room.find(FIND_STRUCTURES, {
            filter: structure =>
                structure.structureType === STRUCTURE_CONTAINER
        });

        const sources = room.find(FIND_SOURCES);

        for (const container of containers) {
            const id = container.id;

            // Ищем источник рядом с контейнером
            const source = sources.find(source =>
                source.pos.getRangeTo(container) <= 1
            );

            // Без привязки к источнику контейнер не удаляем
            if (!source) {
                delete Memory.containerIdleSince[id];
                delete Memory.containerLastEnergy[id];
                continue;
            }

            // Считаем контейнеры возле этой шахты
            const mineContainers = containers.filter(item =>
                item.pos.getRangeTo(source) <= 1
            );


            // Проверяем наличие шахтёра, привязанного к источнику
            const minerExists = Object.values(Game.creeps).some(creep =>
                creep.memory.role === "miner" &&
                creep.memory.mineId === source.id &&
                creep.memory.mineRoomName === roomName
            );

            // Если шахтёра нет, сбрасываем простой всех контейнеров шахты
            if (!minerExists) {
                for (const mineContainer of mineContainers) {
                    delete Memory.containerIdleSince[mineContainer.id];
                    delete Memory.containerLastEnergy[mineContainer.id];
                }

                continue;
            }

            // Единственный контейнер шахты не наблюдаем
            if (mineContainers.length <= 1) {
                delete Memory.containerIdleSince[id];
                delete Memory.containerLastEnergy[id];
                continue;
            }

            const energy = container.store[RESOURCE_ENERGY];
            const capacity = container.store.getCapacity(RESOURCE_ENERGY);
            const previousEnergy = Memory.containerLastEnergy[id];

            // Первое наблюдение за контейнером
            if (previousEnergy === undefined) {
                Memory.containerLastEnergy[id] = energy;

                if (energy < capacity) {
                    Memory.containerIdleSince[id] = Game.time;
                }

                continue;
            }

            // Заполненный контейнер не считается простаивающим
            if (energy >= capacity) {
                delete Memory.containerIdleSince[id];
            }
            // Энергии стало больше — контейнер пополнился
            else if (energy > previousEnergy) {
                delete Memory.containerIdleSince[id];
            }
            // Контейнер не заполнен и пополнения нет
            else if (Memory.containerIdleSince[id] === undefined) {
                Memory.containerIdleSince[id] = Game.time;
            }

            Memory.containerLastEnergy[id] = energy;

            const idleSince = Memory.containerIdleSince[id];
            const idleTicks = idleSince === undefined
                ? 0
                : Game.time - idleSince;

            // Удаляем контейнер после 1000 тиков без пополнения
            if (idleTicks >= 1000 && mineContainers.length > 1) {
                const result = container.destroy();

                if (result === OK) {
                    console.log(
                        `[КОНТЕЙНЕР] Удалён за простой ${idleTicks} тиков` +
                        ` | Комната: ${roomName}` +
                        ` | Источник: ${source.id}` +
                        ` | Контейнер: ${id}` +
                        ` | Осталось у шахты: ${mineContainers.length - 1}`
                    );

                    delete Memory.containerIdleSince[id];
                    delete Memory.containerLastEnergy[id];
                    continue;
                }
            }

            // Статистика раз в 20 тиков
            if (Game.time % 20 === 0) {
                console.log(
                    `[КОНТЕЙНЕР] Комната: ${roomName}` +
                    ` | ID: ${id}` +
                    ` | Энергия: ${energy}/${capacity}` +
                    ` | Без пополнения: ${idleTicks} тиков`
                );
            }
        }
    }
}

// удаление расширителей находящихся рядом со сторадж
function removeExtensionsNearStorage(room) {
    const storages = room.find(FIND_MY_STRUCTURES, {
        filter: structure =>
            structure.structureType === STRUCTURE_STORAGE
    });

    // Если Storage ещё нет, ничего не делаем
    if (storages.length === 0) return;

    const extensions = room.find(FIND_MY_STRUCTURES, {
        filter: structure =>
            structure.structureType === STRUCTURE_EXTENSION
    });

    for (const extension of extensions) {
        const nearStorage = storages.some(storage =>
            extension.pos.getRangeTo(storage) <= 1
        );

        if (!nearStorage) continue;

        const result = extension.destroy();

        if (result === OK) {
            console.log(
                `[STORAGE] Удалён расширитель (${extension.pos.x}, ${extension.pos.y})` +
                ` | Причина: находится рядом со Storage`
            );
        }
    }
}

/**
 * Определяет, до каких сторон комнаты сохраняется путь от Spawn.
 * blockedX и blockedY — клетка, которую проверяем
 * как потенциально занятую новым расширителем.
 */
function getReachableRoomSides(
    walkable,
    spawn,
    blockedX = -1,
    blockedY = -1
) {
    const visited = Array.from(
        { length: 50 },
        () => Array(50).fill(false)
    );

    const queue = [];

    const canWalk = (x, y) =>
        x >= 0 &&
        x < 50 &&
        y >= 0 &&
        y < 50 &&
        walkable[x][y] &&
        !(x === blockedX && y === blockedY);

    // Начинаем обход со свободных клеток вокруг Spawn
    for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
            if (dx === 0 && dy === 0) continue;

            const x = spawn.pos.x + dx;
            const y = spawn.pos.y + dy;

            if (!canWalk(x, y) || visited[x][y]) {
                continue;
            }

            visited[x][y] = true;
            queue.push({ x, y });
        }
    }

    const sides = new Set();
    let index = 0;

    // Обходим все доступные клетки комнаты
    while (index < queue.length) {
        const { x, y } = queue[index++];

        if (x === 0) sides.add("left");
        if (x === 49) sides.add("right");
        if (y === 0) sides.add("top");
        if (y === 49) sides.add("bottom");

        for (let dx = -1; dx <= 1; dx++) {
            for (let dy = -1; dy <= 1; dy++) {
                if (dx === 0 && dy === 0) continue;

                const nx = x + dx;
                const ny = y + dy;

                if (!canWalk(nx, ny) || visited[nx][ny]) {
                    continue;
                }

                visited[nx][ny] = true;
                queue.push({ x: nx, y: ny });
            }
        }
    }

    return sides;
}

// Проверка зарезервированных проходов вокруг Spawn
function isReservedExtensionTile(x, y, spawn) {
    const dx = x - spawn.pos.x;
    const dy = y - spawn.pos.y;

    // Горизонтальный и вертикальный проходы
    if (dx === 0 || dy === 0) {
        return true;
    }

    // Четыре диагональных прохода относительно Spawn
    if (Math.abs(dx) === Math.abs(dy)) {
        return true;
    }

    return false;
}


// Автоматический выбор места для Storage
function manageStorageConstruction(room, spawn) {

    // Storage доступен с RCL 4
    if (!room.controller || room.controller.level < 4) {
        return;
    }

    // Storage уже построен
    if (room.storage) {
        return;
    }

    // Storage уже строится
    const storageSites = room.find(FIND_MY_CONSTRUCTION_SITES, {
        filter: site =>
            site.structureType === STRUCTURE_STORAGE
    });

    if (storageSites.length > 0) {
        return;
    }

    const terrain = room.getTerrain();
    const structures = room.find(FIND_STRUCTURES);
    const constructionSites = room.find(FIND_CONSTRUCTION_SITES);

    // Клетки, занятые постройками
    const occupied = new Set();

    for (const structure of structures) {
        occupied.add(`${structure.pos.x},${structure.pos.y}`);
    }

    for (const site of constructionSites) {
        occupied.add(`${site.pos.x},${site.pos.y}`);
    }

    // Источники энергии
    const sources = room.find(FIND_SOURCES);

    // Контроллер комнаты
    const controller = room.controller;

    // Карта проходимости
    const walkable = Array.from(
        { length: 50 },
        (_, x) => Array.from(
            { length: 50 },
            (_, y) =>
                terrain.get(x, y) !== TERRAIN_MASK_WALL
        )
    );

    // Учитываем непроходимые структуры
    for (const structure of structures) {
        if (
            OBSTACLE_OBJECT_TYPES.includes(
                structure.structureType
            )
        ) {
            walkable[structure.pos.x][structure.pos.y] = false;
        }
    }

    // Какие стороны комнаты доступны до строительства
    const originalSides = getReachableRoomSides(
        walkable,
        spawn
    );

    let bestPosition = null;
    let bestScore = Infinity;

    // Проверяем все внутренние клетки комнаты
    for (let x = 2; x < 48; x++) {
        for (let y = 2; y < 48; y++) {

            // Нельзя строить на стене или занятой клетке
            if (terrain.get(x, y) === TERRAIN_MASK_WALL) {
                continue;
            }

            if (occupied.has(`${x},${y}`)) {
                continue;
            }

            // Сохраняем зарезервированные проходы от Spawn
            if (isReservedExtensionTile(x, y, spawn)) {
                continue;
            }

            // Проверяем свободные соседние клетки
            let freeNeighbors = 0;

            for (let dx = -1; dx <= 1; dx++) {
                for (let dy = -1; dy <= 1; dy++) {
                    if (dx === 0 && dy === 0) continue;

                    const nx = x + dx;
                    const ny = y + dy;

                    if (
                        nx < 1 || nx > 48 ||
                        ny < 1 || ny > 48
                    ) {
                        continue;
                    }

                    if (!walkable[nx][ny]) continue;

                    if (occupied.has(`${nx},${ny}`)) continue;

                    freeNeighbors++;
                }
            }

            // Storage должен иметь место для подхода
            if (freeNeighbors < 4) continue;

            // Проверяем, не перекроет ли Storage доступ
            const newSides = getReachableRoomSides(
                walkable,
                spawn,
                x,
                y
            );

            const preservesAccess = [...originalSides].every(
                side => newSides.has(side)
            );

            if (!preservesAccess) continue;

            // Расстояние до Spawn
            const spawnDistance = Math.max(
                Math.abs(x - spawn.pos.x),
                Math.abs(y - spawn.pos.y)
            );

            // Расстояние до ближайшего источника
            let nearestSourceDistance = Infinity;

            for (const source of sources) {
                const distance = Math.max(
                    Math.abs(x - source.pos.x),
                    Math.abs(y - source.pos.y)
                );

                nearestSourceDistance = Math.min(
                    nearestSourceDistance,
                    distance
                );
            }

            // Расстояние до контроллера
            const controllerDistance = Math.max(
                Math.abs(x - controller.pos.x),
                Math.abs(y - controller.pos.y)
            );

            // Оценка клетки: меньше — лучше
            const score =
                spawnDistance * 3 +
                nearestSourceDistance * 1.5 +
                controllerDistance * 0.5 -
                freeNeighbors * 0.2;

            if (score < bestScore) {
                bestScore = score;
                bestPosition = { x, y };
            }
        }
    }

    if (!bestPosition) {
        console.log(
            `[STORAGE] ${room.name}: подходящее место не найдено`
        );
        return;
    }

    // Создаём площадку на лучшей клетке
    const result = room.createConstructionSite(
        bestPosition.x,
        bestPosition.y,
        STRUCTURE_STORAGE
    );

    if (result === OK) {
        console.log(
            `[STORAGE] ${room.name}: площадка создана на ` +
            `(${bestPosition.x}, ${bestPosition.y}), ` +
            `оценка ${bestScore.toFixed(1)}`
        );
    } else {
        console.log(
            `[STORAGE] ${room.name}: ошибка создания площадки: ${result}`
        );
    }
}

// Установка расширителей
function manageExtensionConstruction(room, spawn) {
    // Расширители доступны начиная с RCL 2
    if (!room.controller || room.controller.level < 2) {
        return;
    }

    // Максимально разрешённое количество расширителей
    const maxExtensions =
        CONTROLLER_STRUCTURES[STRUCTURE_EXTENSION][
        room.controller.level
        ];

    // Количество уже построенных расширителей
    const extensions = room.find(FIND_MY_STRUCTURES, {
        filter: structure =>
            structure.structureType === STRUCTURE_EXTENSION
    });

    if (extensions.length >= maxExtensions) {
        return;
    }

    // Не создаём следующую площадку, пока строится предыдущая
    const extensionSites = room.find(FIND_MY_CONSTRUCTION_SITES, {
        filter: site =>
            site.structureType === STRUCTURE_EXTENSION
    });

    if (extensionSites.length > 0) {
        return;
    }

    const terrain = room.getTerrain();

    // Создаём карту проходимости существующих клеток
    const walkable = Array.from(
        { length: 50 },
        (_, x) => Array.from(
            { length: 50 },
            (_, y) =>
                terrain.get(x, y) !== TERRAIN_MASK_WALL
        )
    );

    // Учитываем уже построенные непроходимые структуры
    const structures = room.find(FIND_STRUCTURES);

    for (const structure of structures) {
        if (
            OBSTACLE_OBJECT_TYPES.includes(
                structure.structureType
            )
        ) {
            walkable[structure.pos.x][structure.pos.y] = false;
        }
    }

    // Запоминаем стороны комнаты, доступные до строительства
    const originalSides = getReachableRoomSides(
        walkable,
        spawn
    );

    // Ищем свободные клетки недалеко от Spawn

    // Ищем место по радиусам: сначала ближние, затем дальние
    for (let radius = 2; radius <= 20; radius++) {
        const candidates = [];

        for (let x = 1; x < 49; x++) {
            for (let y = 1; y < 49; y++) {
                const distance = Math.max(
                    Math.abs(x - spawn.pos.x),
                    Math.abs(y - spawn.pos.y)
                );


                if (distance !== radius) continue;

                // Не занимаем зарезервированные проходы
                if (isReservedExtensionTile(x, y, spawn)) continue;

                // Не строим расширители вплотную к Storage
                const nearStorage = room.find(FIND_MY_STRUCTURES, {
                    filter: structure =>
                        structure.structureType === STRUCTURE_STORAGE
                }).some(storage =>
                    Math.max(
                        Math.abs(x - storage.pos.x),
                        Math.abs(y - storage.pos.y)
                    ) <= 1
                );

                if (nearStorage) continue;

                if (!walkable[x][y]) continue;


                const sites = room.lookForAt(
                    LOOK_CONSTRUCTION_SITES,
                    x,
                    y
                );

                if (sites.length > 0) continue;

                candidates.push({ x, y });
            }
        }

        // Проверяем все клетки текущего радиуса
        for (const candidate of candidates) {
            const newSides = getReachableRoomSides(
                walkable,
                spawn,
                candidate.x,
                candidate.y
            );

            const preservesAccess = [...originalSides].every(
                side => newSides.has(side)
            );

            if (!preservesAccess) continue;

            const result = room.createConstructionSite(
                candidate.x,
                candidate.y,
                STRUCTURE_EXTENSION
            );

            if (result === OK) {
                console.log(
                    `[EXTENSION] Радиус ${radius}: создана площадка (${candidate.x}, ${candidate.y})`
                );
                return;
            }
        }
    }

    console.log(
        "[EXTENSION] Не найдено подходящего места в радиусе 2–20"
    );
}



// Анализ шахт в комнате
function analyzeMines(room) {
    const sources = room.find(FIND_SOURCES);
    const mines = [];

    for (const source of sources) {
        // Находим построенный контейнер рядом с источником
        const containers = source.pos.findInRange(
            FIND_STRUCTURES,
            1,
            {
                filter: structure =>
                    structure.structureType === STRUCTURE_CONTAINER
            }
        );

        const container = containers[0] || null;

        // Проверяем все клетки вокруг источника
        const positions = [];

        for (let dx = -1; dx <= 1; dx++) {
            for (let dy = -1; dy <= 1; dy++) {
                if (dx === 0 && dy === 0) continue;

                const x = source.pos.x + dx;
                const y = source.pos.y + dy;

                // Не выходим за границы комнаты
                if (x < 0 || x > 49 || y < 0 || y > 49) {
                    continue;
                }

                // Пропускаем стены
                if (
                    room.getTerrain().get(x, y) === TERRAIN_MASK_WALL
                ) {
                    continue;
                }

                // Проверяем, нет ли непроходимой постройки
                const structures = room.lookForAt(
                    LOOK_STRUCTURES,
                    x,
                    y
                );

                const blocked = structures.some(structure =>
                    OBSTACLE_OBJECT_TYPES.includes(
                        structure.structureType
                    )
                );

                if (blocked) continue;

                positions.push({ x, y });
            }
        }

        // Уровень 1 — контейнера нет.
        // Уровень 2 — контейнер построен.
        const level = container ? 2 : 1;

        // Если есть контейнер, резервируем одну позицию
        // для стационарного шахтёра.
        const workerSlots = Math.max(
            0,
            positions.length - (container ? 1 : 0)
        );

        mines.push({
            id: source.id,
            roomName: room.name,
            x: source.pos.x,
            y: source.pos.y,
            level: level,
            containerId: container ? container.id : null,
            availablePositions: positions.length,
            workerSlots: workerSlots
        });
    }

    return mines;
}



// Расчёт потребности шахт в юнитах
function calculateMineNeeds(room) {
    const mines = analyzeMines(room);

    return mines.map(mine => {
        // Проверяем наличие мощного шахтёра на этой шахте
        const hasPowerfulMiner = Object.values(Game.creeps).some(creep =>
            creep.memory.role === "miner" &&
            creep.memory.mineId === mine.id &&
            creep.memory.mineRoomName === room.name &&
            creep.body.filter(part => part.type === WORK).length >= 6
        );

        const desiredHarvesters = hasPowerfulMiner
            ? 0
            : mine.level === 1
                ? mine.availablePositions
                : mine.workerSlots;

        const desiredMiners = mine.level >= 2 ? 1 : 0;

        return {
            ...mine,
            desiredHarvesters: desiredHarvesters,
            desiredMiners: desiredMiners,
            desiredTotal:
                desiredHarvesters + desiredMiners
        };
    });
}



// Расчёт потребности шахт во всех разрешённых комнатах
function calculateAllMineNeeds(homeRoom) {
    const roomNames = [
        homeRoom.name,
        ...REMOTE_ROOMS
    ];

    const allMines = [];

    for (const roomName of roomNames) {
        const room = Game.rooms[roomName];

        // Комната должна быть видима игре
        if (!room) continue;

        const mines = calculateMineNeeds(room);

        allMines.push(...mines);
    }

    return allMines;
}


// Назначение обычных добытчиков шахтам

function assignHarvestersToMines(homeRoom) {
    const mines = calculateAllMineNeeds(homeRoom);

    const harvesters = Object.values(Game.creeps).filter(
        creep =>
            creep.memory.role === "harvester" ||
            creep.memory.role === "remoteHarvester"
    );

    for (const mine of mines) {
        const assigned = harvesters.filter(
            creep => creep.memory.mineId === mine.id
        );

        const unassigned = harvesters.filter(
            creep => !creep.memory.mineId
        );

        const missing = Math.max(
            0,
            mine.desiredHarvesters - assigned.length
        );

        for (
            let i = 0;
            i < missing && unassigned.length > 0;
            i++
        ) {
            const creep = unassigned.shift();

            creep.memory.mineId = mine.id;
            creep.memory.mineRoomName = mine.roomName;

            console.log(
                "[НАЗНАЧЕНИЕ ДОБЫТЧИКА]",
                creep.name,
                "-> Комната:",
                mine.roomName,
                "Источник:",
                mine.id
            );
        }
    }
}

// Сравнение потребности шахт с назначенными юнитами
function reportMineAssignments(room) {
    const mines = calculateMineNeeds(room);
    const creeps = Object.values(Game.creeps);

    for (const mine of mines) {
        const miners = creeps.filter(creep =>
            creep.memory.role === "miner" &&
            creep.memory.mineId === mine.id
        ).length;

        const harvesters = creeps.filter(creep =>
            creep.memory.role === "harvester" &&
            creep.memory.mineId === mine.id
        ).length;

        console.log(
            "[ОБСЛУЖИВАНИЕ ШАХТЫ]",
            "Комната:", mine.roomName,
            "Источник:", mine.id,
            "Обычные добытчики:",
            harvesters + "/" + mine.desiredHarvesters,
            "Шахтёры:",
            miners + "/" + mine.desiredMiners
        );
    }
}

// Назначение шахтёров конкретным шахтам
function assignMinersToMines(homeRoom) {
    const miners = Object.values(Game.creeps).filter(
        creep => creep.memory.role === "miner"
    );

    for (const creep of miners) {
        // Уже назначенному шахтёру новое назначение не нужно

        if (creep.memory.mineId) continue;

        const roomName =
            creep.memory.targetRoom || creep.room.name;

        const room = Game.rooms[roomName];

        // Если комната не видна, пока пропускаем шахтёра
        if (!room) continue;

        const mines = calculateMineNeeds(room).filter(
            mine => mine.level >= 2
        );

        // Источники, которые уже обслуживают другие шахтёры
        const assignedMineIds = new Set(
            miners
                .filter(other =>
                    other.name !== creep.name &&
                    other.memory.mineId
                )
                .map(other => other.memory.mineId)
        );

        const mine = mines.find(
            item => !assignedMineIds.has(item.id)
        );

        if (!mine) continue;

        creep.memory.mineId = mine.id;
        creep.memory.targetRoom = mine.roomName;
        creep.memory.mineRoomName = mine.roomName;

        console.log(
            "[НАЗНАЧЕНИЕ ШАХТЁРА]",
            creep.name,
            "->",
            mine.roomName,
            mine.id
        );
    }
}



// Главный цикл
module.exports.loop = function () {
    const spawn = Game.spawns["Spawn1"];

    if (!spawn) return;

    const homeRoom = spawn.room;

    //УПРАВЛЕНИЕ БАШНЕЙ
    manageTower();

    manageSpawning(spawn);
    military.manageSpawning(spawn);
    reserver.manageSpawning(spawn);
    advancedUpgrader.manageSpawning(spawn);

    assignHarvestersToMines(homeRoom);

    if (Game.time % 50 === 0) {
        for (const roomName of [
            homeRoom.name,
            ...REMOTE_ROOMS
        ]) {
            const room = Game.rooms[roomName];

            if (room) {
                reportMineAssignments(room);
            }
        }
    }

    assignMinersToMines(homeRoom);
    //установка контейнера в домашней зоне рядом с шахтой
    manageContainerConstruction(homeRoom);
    //Установка контейнера в дальней комнате рядом с шахтой
    const remoteRoom = Game.rooms[REMOTE_ROOM];
    if (remoteRoom) {
        manageContainerConstruction(remoteRoom);
    }

    // Сначала выбираем место для Storage
    manageStorageConstruction(homeRoom, spawn);
    // удаление расширителей находящихся рядом со сторадж
    removeExtensionsNearStorage(homeRoom);
    //проверяем нужно ли строить расширители
    manageExtensionConstruction(homeRoom, spawn);

    //мониторинг контейнеров
    monitorContainerIdleTime(homeRoom);

    construction.manageControllerContainerConstruction(homeRoom);

    const site = homeRoom.find(
        FIND_MY_CONSTRUCTION_SITES
    )[0];

    const containers = homeRoom.find(FIND_STRUCTURES, {
        filter: structure =>
            structure.structureType === STRUCTURE_CONTAINER
    });

    // Запускаем поведение каждой роли
    for (const name in Game.creeps) {
        const creep = Game.creeps[name];

        if (creep.memory.role === "harvester") {
            runHarvester(creep, spawn, containers, site);
        }

        if (creep.memory.role === "upgrader") {
            runUpgrader(creep, homeRoom, containers);
        }

        if (creep.memory.role === "builder") {
            runBuilder(creep, spawn, homeRoom);
        }
        if (creep.memory.role === "repairer") {
            runRepairer(creep, homeRoom);
        }
        if (creep.memory.role === "miner") {
            runMiner(creep, homeRoom);
        }
        if (creep.memory.role === "scout") {
            runScout(creep);
        }
        if (creep.memory.role === "carrier") {
            runCarrier(creep, spawn, homeRoom);
        }
        if (creep.memory.role === "towerSupport") {
            runTowerSupport(creep, spawn);
        }
        if (creep.memory.role === "melee") {
            military.runMelee(creep, TOWER_CONTAINER_IDS[0]);
        }
        if (creep.memory.role === "ranged") {
            military.runRanged(creep, TOWER_CONTAINER_IDS[0]);
        }
        if (creep.memory.role === "reserver") {
            reserver.run(creep);
        }
        if (creep.memory.role === "advancedUpgrader") {
            advancedUpgrader.run(creep, homeRoom);
        }
        if (creep.memory.role === "emergencyAttacker") {
            military.runEmergencyAttacker(creep);
        }

    }
};


