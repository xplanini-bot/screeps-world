const roomConfig = require("roomConfig");

// Освобождение клетки, если под крипом появилась строительная площадка
function moveOffConstructionSite(creep) {
    const room = creep.room;

    const sites = room.lookForAt(
        LOOK_CONSTRUCTION_SITES,
        creep.pos.x,
        creep.pos.y
    );

    if (sites.length === 0) return false;

    const positions = [];

    for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
            if (dx === 0 && dy === 0) continue;

            const x = creep.pos.x + dx;
            const y = creep.pos.y + dy;

            if (x < 1 || x > 48 || y < 1 || y > 48) continue;

            if (room.getTerrain().get(x, y) === TERRAIN_MASK_WALL) {
                continue;
            }

            const structures = room.lookForAt(LOOK_STRUCTURES, x, y);

            if (structures.some(structure =>
                OBSTACLE_OBJECT_TYPES.includes(structure.structureType) &&
                !(structure.structureType === STRUCTURE_RAMPART && structure.my)
            )) {
                continue;
            }

            if (
                room.lookForAt(LOOK_CONSTRUCTION_SITES, x, y).length > 0
            ) {
                continue;
            }

            if (room.lookForAt(LOOK_CREEPS, x, y).length > 0) {
                continue;
            }

            positions.push(new RoomPosition(x, y, room.name));
        }
    }

    if (positions.length > 0) {
        positions.sort((a, b) =>
            creep.pos.getRangeTo(a) - creep.pos.getRangeTo(b)
        );

        creep.moveTo(positions[0], {
            range: 0,
            reusePath: 10,
            costCallback: construction.avoidConstructionSites
        });
    }

    return true;
}

// Строительство контейнера возле контроллера
function manageControllerContainerConstruction(room) {
    const controller = room.controller;

    if (!controller || !room.storage) return;

    // Ждём, пока будет построено достаточно расширителей
    const extensions = room.find(FIND_MY_STRUCTURES, {
        filter: structure =>
            structure.structureType === STRUCTURE_EXTENSION
    });

    if (extensions.length < 17) return;

    // Если контейнер уже построен рядом с контроллером,
    // строительство не требуется
    const existingContainer = room.find(FIND_STRUCTURES, {
        filter: structure =>
            structure.structureType === STRUCTURE_CONTAINER &&
            structure.pos.getRangeTo(controller) <= 1
    });

    if (existingContainer.length > 0) return;

    // Если площадка контейнера уже существует, повторно её не создаём
    const existingSite = room.find(FIND_CONSTRUCTION_SITES, {
        filter: site =>
            site.structureType === STRUCTURE_CONTAINER &&
            site.pos.getRangeTo(controller) <= 1
    });

    if (existingSite.length > 0) return;

    // Проверяем восемь соседних клеток контроллера
    const positions = [];

    for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
            if (dx === 0 && dy === 0) continue;

            const x = controller.pos.x + dx;
            const y = controller.pos.y + dy;

            // Не используем клетки на границе комнаты
            if (x <= 0 || x >= 49 || y <= 0 || y >= 49) {
                continue;
            }

            const terrain = room.getTerrain().get(x, y);

            if (terrain === TERRAIN_MASK_WALL) continue;

            // Проверяем, можно ли построить контейнер на клетке
            const result = room.lookForAt(
                LOOK_STRUCTURES,
                x,
                y
            );

            if (result.some(structure =>
                structure.structureType !== STRUCTURE_ROAD &&
                structure.structureType !== STRUCTURE_RAMPART
            )) {
                continue;
            }

            const sites = room.lookForAt(
                LOOK_CONSTRUCTION_SITES,
                x,
                y
            );

            if (sites.length > 0) continue;

            positions.push({ x, y });
        }
    }

    // Пробуем создать площадку на подходящей клетке
    for (const pos of positions) {
        const result = room.createConstructionSite(
            pos.x,
            pos.y,
            STRUCTURE_CONTAINER
        );

        if (result === OK) {
            console.log(
                `[СТРОИТЕЛЬСТВО] Создана площадка контейнера ` +
                `возле контроллера в комнате ${room.name}: ` +
                `${pos.x},${pos.y}`
            );

            return;
        }
    }
}

// Запрет прохода через клетки со строительными площадками
function avoidConstructionSites(roomName, costMatrix) {
    const room = Game.rooms[roomName];

    // Если комната не видна, оставляем маршрут без изменений
    if (!room) return costMatrix;

    const sites = room.find(FIND_CONSTRUCTION_SITES);

    for (const site of sites) {
        costMatrix.set(site.pos.x, site.pos.y, 255);
    }

    return costMatrix;
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
                // Оставляем свободным кольцо вокруг Spawn на расстоянии 5 клеток
                if (distance === 5) continue;

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


module.exports = {
    manageContainerConstruction,
    monitorContainerIdleTime,
    removeExtensionsNearStorage,
    manageStorageConstruction,
    manageExtensionConstruction,
    manageControllerContainerConstruction,
    moveOffConstructionSite,
    avoidConstructionSites
};
