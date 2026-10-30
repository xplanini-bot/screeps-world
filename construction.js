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
            reusePath: 10
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

module.exports = {
    manageControllerContainerConstruction,
    moveOffConstructionSite
};
