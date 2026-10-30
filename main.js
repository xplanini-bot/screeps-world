// Подключение главных переменных
const roomConfig = require("roomConfig");

const military = require("military");
const reserver = require("reserver");
const advancedUpgrader = require("advancedUpgrader");
//логика размещения строений
const construction = require("construction");
//логика атакующих юнитов
const attacker = require("attacker");
const upgrader = require("upgrader");
const miner = require("miner");
const builderModule = require("builder");
//const combatMiner = require("combatMiner");

const carrier = require("carrier");
const berserkMiner = require("berserkMiner");

const CREEP_BODY = [WORK, CARRY, MOVE];

// Тело разведчика
const SCOUT_BODY = [MOVE];

// Создание крипов
function manageSpawning(spawn) {
    if (spawn.spawning) return;

    // Передаём создание обслуживающего башню крипа модулю
    if (towerDelivery.manageSpawning(spawn)) {
        return;
    }

    const creeps = Object.values(Game.creeps);

    const countRole = role =>
        creeps.filter(creep => creep.memory.role === role).length;



    // Проверяем, есть ли контейнеры в домашней или удалённых комнатах
    const repairRoomNames = [
        spawn.room.name,
        ...roomConfig.REMOTE_ROOMS
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


    // До появления первого контейнера ремонтник не нужен
    const repairerCount = hasContainers ? 1 : 0;

    const allMines = calculateAllMineNeeds(spawn.room);

    const desiredHarvesters = allMines.reduce(
        (total, mine) => total + mine.desiredHarvesters,
        0
    );


    // Приоритет создания
    const roles = [

        {
            role: "harvester",
            desired: desiredHarvesters,
            prefix: "Harvester",
            body: CREEP_BODY
        },
        {
            role: "repairer",
            desired: repairerCount,
            prefix: "Repairer",
            body: builderModule.getBody(spawn.room)
        }

    ];

    // Передаём создание шахтёров модулю miner
    if (miner.manageSpawning(spawn, calculateAllMineNeeds)) {
        return;
    }

    // Передаём создание перевозчиков модулю carrier
    if (carrier.manageSpawning(spawn)) {
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
    for (const roomName of roomConfig.REMOTE_ROOMS) {

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
// Обычный добытчик
function runHarvester(creep, spawn, containers, site) {
    const homeRoom = spawn.room;
    const storage = homeRoom.storage;

    // Если есть Storage, сначала восстанавливаем
    // энергию в Spawn и Extensions.
    if (storage) {
        const spawnNeedsEnergy =
            spawn.store.getFreeCapacity(RESOURCE_ENERGY) > 0;

        const extensions = homeRoom.find(FIND_MY_STRUCTURES, {
            filter: structure =>
                structure.structureType === STRUCTURE_EXTENSION &&
                structure.store.getFreeCapacity(RESOURCE_ENERGY) > 0
        });

        const needsEnergy =
            spawnNeedsEnergy || extensions.length > 0;

        if (needsEnergy) {

            // Если энергия уже есть у харвестера,
            // сначала заполняем Spawn.
            if (creep.store[RESOURCE_ENERGY] > 0) {
                if (spawnNeedsEnergy) {
                    const result = creep.transfer(
                        spawn,
                        RESOURCE_ENERGY
                    );

                    if (result === ERR_NOT_IN_RANGE) {
                        creep.moveTo(spawn);
                    }

                    return;
                }

                // Spawn заполнен — пополняем ближайший Extension.
                const extension =
                    creep.pos.findClosestByRange(extensions);

                if (extension) {
                    const result = creep.transfer(
                        extension,
                        RESOURCE_ENERGY
                    );

                    if (result === ERR_NOT_IN_RANGE) {
                        creep.moveTo(extension);
                    }

                    return;
                }
            }

            // Если харвестер пуст, берём энергию из Storage.
            if (
                creep.store[RESOURCE_ENERGY] === 0 &&
                storage.store[RESOURCE_ENERGY] > 0
            ) {
                const result = creep.withdraw(
                    storage,
                    RESOURCE_ENERGY
                );

                if (result === ERR_NOT_IN_RANGE) {
                    creep.moveTo(storage, { range: 1 });
                }

                return;
            }
        }
    }

    // Если Storage отсутствует, пуст или Spawn и Extensions
    // уже заполнены, используем прежнюю логику.
    updateWorkingState(creep);

    if (!creep.memory.working) {
        harvestEnergy(creep);
        return;
    }

    deliverEnergy(creep, spawn, containers, site);
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
            ...roomConfig.REMOTE_ROOMS
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
                repairTarget.id === towerDelivery.TOWER_ID ||
                towerDelivery.TOWER_CONTAINER_IDS.includes(repairTarget.id)
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
        ...roomConfig.REMOTE_ROOMS
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
                        structure.id === towerDelivery.TOWER_ID ||
                        towerDelivery.TOWER_CONTAINER_IDS.includes(structure.id)
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

            // Для обычных перевозчиков находим контейнер контроллера
            const controllerContainer =
                creep.memory.role === "carrier"
                    ? advancedUpgrader.findControllerContainer(room)
                    : null;

            const structures = room.find(FIND_STRUCTURES, {
                filter: structure =>
                    structure.structureType === structureType &&
                    structure.store[RESOURCE_ENERGY] > 0
            });

            for (const structure of structures) {

                // Контейнеры башни доступны только towerSupport
                if (
                    structure.structureType === STRUCTURE_CONTAINER &&
                    towerDelivery.TOWER_CONTAINER_IDS.includes(structure.id) &&
                    creep.memory.role !== "towerSupport"
                ) {
                    continue;
                }

                // Обычные перевозчики не забирают энергию
                // из контейнера возле контроллера
                if (
                    creep.memory.role === "carrier" &&
                    controllerContainer &&
                    structure.id === controllerContainer.id
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
        ...roomConfig.REMOTE_ROOMS
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
            if (idleTicks >= 5000 && mineContainers.length > 1) {
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

    // Храним координаты выбранного места для Storage
    if (!Memory.storageConstructionPlans) {
        Memory.storageConstructionPlans = {};
    }

    // Storage уже построен
    if (room.storage) {
        delete Memory.storageConstructionPlans[room.name];
        return;
    }

    // Проверяем существующую площадку Storage
    const storageSites = room.find(FIND_MY_CONSTRUCTION_SITES, {
        filter: site =>
            site.structureType === STRUCTURE_STORAGE
    });

    // Уже установленную старым кодом площадку не трогаем
    if (storageSites.length > 0) {
        return;
    }

    // Проверяем, есть ли сохранённая позиция
    const plannedPosition =
        Memory.storageConstructionPlans[room.name];

    if (plannedPosition) {
        const { x, y } = plannedPosition;

        const structuresAtPosition = room.lookForAt(
            LOOK_STRUCTURES, x, y
        );

        const sitesAtPosition = room.lookForAt(
            LOOK_CONSTRUCTION_SITES, x, y
        );

        const rampart = structuresAtPosition.find(
            structure =>
                structure.structureType === STRUCTURE_RAMPART &&
                structure.my
        );

        const hasRampartSite = sitesAtPosition.some(
            site =>
                site.structureType === STRUCTURE_RAMPART &&
                site.my
        );

        // Рампарт уже построен — можно ставить Storage
        if (rampart) {

            // Не размещаем Storage, пока рампарт не укреплён до 1000 hits
            if (rampart.hits < 1000) {
                if (Game.time % 20 === 0) {
                    console.log(
                        `[STORAGE] ${room.name}: ждём укрепления рампарта` +
                        ` на (${x}, ${y}), прочность: ${rampart.hits}/1000`
                    );
                }

                return;
            }

            const result = room.createConstructionSite(
                x,
                y,
                STRUCTURE_STORAGE
            );
        } else if (hasRampartSite) {
            // Рампарт строится — ждём его завершения
            return;
        } else {
            // Рампарта нет — создаём его площадку заново
            const result = room.createConstructionSite(
                x,
                y,
                STRUCTURE_RAMPART
            );

            if (result === OK) {
                console.log(
                    `[STORAGE] ${room.name}: создана площадка рампарта ` +
                    `на (${x}, ${y})`
                );

                return;
            }

            // Если место стало непригодным, пересчитываем позицию
            if (result === ERR_INVALID_TARGET) {
                delete Memory.storageConstructionPlans[room.name];
            } else {
                return;
            }
        }
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

    // Запоминаем выбранную клетку
    Memory.storageConstructionPlans[room.name] = bestPosition;

    // Сначала строим рампарт
    const result = room.createConstructionSite(
        bestPosition.x,
        bestPosition.y,
        STRUCTURE_RAMPART
    );

    if (result === OK) {
        console.log(
            `[STORAGE] ${room.name}: создана площадка рампарта на ` +
            `(${bestPosition.x}, ${bestPosition.y})`
        );
    } else {
        if (result === ERR_INVALID_TARGET) {
            delete Memory.storageConstructionPlans[room.name];
        }

        console.log(
            `[STORAGE] ${room.name}: ошибка создания площадки рампарта: ${result}`
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
        // Проверяем наличие майнера на этой шахте
        const hasMiner = Object.values(Game.creeps).some(creep =>
            creep.memory.role === "miner" &&
            creep.memory.mineId === mine.id &&
            creep.memory.mineRoomName === room.name
        );

        // Если на шахте есть майнер, обычные харвестеры не нужны
        const desiredHarvesters = hasMiner
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
        ...roomConfig.REMOTE_ROOMS
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

    // УПРАВЛЕНИЕ БАШНЕЙ в отдельном модуле
    towerDelivery.manageTower();

    const minerReplacementWaiting = manageSpawning(spawn);

    if (!minerReplacementWaiting) {
        military.manageSpawning(spawn);
        attacker.manageSpawning(spawn);
        reserver.manageSpawning(spawn);
        advancedUpgrader.manageSpawning(spawn);
        upgrader.manageSpawning(spawn, roomConfig.REMOTE_ROOMS);
        builderModule.manageSpawning(spawn, roomConfig.REMOTE_ROOMS);
        //combatMiner.manageSpawning(spawn);
        berserkMiner.manageSpawning(spawn);
    }

    assignHarvestersToMines(homeRoom);

    if (Game.time % 50 === 0) {
        for (const roomName of [
            homeRoom.name,
            ...roomConfig.REMOTE_ROOMS
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

        if (creep.memory.role === upgrader.role) {
            upgrader.run(creep, homeRoom, {
                updateWorkingState,
                releaseEnergyReservation,
                findEnergyContainer,
                getReservedEnergy,
                reserveEnergy
            });
        }

        if (creep.memory.role === builderModule.role) {
            builderModule.run(creep, homeRoom, roomConfig.REMOTE_ROOMS, {
                releaseEnergyReservation,
                findEnergyContainer,
                getReservedEnergy,
                reserveEnergy
            });
        }
        if (creep.memory.role === "repairer") {
            runRepairer(creep, homeRoom);
        }
        if (creep.memory.role === miner.role) {
            miner.run(creep, homeRoom);
        }
        if (creep.memory.role === "scout") {
            runScout(creep);
        }

        if (creep.memory.role === "carrier") {
            carrier.run(creep, spawn, homeRoom, {
                findEnergyContainer,
                getReservedEnergy,
                reserveEnergy,
                releaseEnergyReservation
            });
        }
        // обслуживание башни
        if (creep.memory.role === "towerSupport") {
            towerDelivery.runTowerSupport(creep, spawn);
        }

        if (creep.memory.role === "melee") {
            military.runMelee(creep, towerDelivery.TOWER_CONTAINER_IDS[0]);
        }
        if (creep.memory.role === "ranged") {
            military.runRanged(creep, towerDelivery.TOWER_CONTAINER_IDS[0]);
        }
        if (creep.memory.role === "reserver") {
            reserver.run(creep);
        }
        if (creep.memory.role === "advancedUpgrader") {
            advancedUpgrader.run(creep, homeRoom);
        }
        if (creep.memory.role === "emergencyAttacker") {
            military.runEmergencyAttacker(creep, spawn);
        }
        if (creep.memory.role === attacker.role) {
            attacker.runAttacker(creep, spawn);
        }
        if (creep.memory.role === attacker.healerRole) {
            attacker.runAttackerHealer(creep, spawn);
        }
        //if (creep.memory.role === combatMiner.role) {
        //    combatMiner.run(creep);
        //}
        if (creep.memory.role === "berserkMiner") {
            berserkMiner.run(creep);
        }
        if (creep.memory.role === "berserkCarrier") {
            berserkMiner.runCarrier(creep);
        }
    }
};


