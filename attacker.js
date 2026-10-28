

function calculatePositionPlans(room) {
    const keepers = room.find(FIND_HOSTILE_CREEPS, {
        filter: hostile =>
            hostile.owner &&
            hostile.owner.username === "Source Keeper"
    });

    if (keepers.length === 0) {
        return { error: "В комнате не найден ни один Source Keeper." };
    }

    // Сортируем для стабильного порядка вывода в логе.
    keepers.sort((a, b) =>
        a.pos.x - b.pos.x || a.pos.y - b.pos.y
    );

    const lairs = room.find(FIND_STRUCTURES, {
        filter: structure =>
            structure.structureType === STRUCTURE_KEEPER_LAIR
    });

    const sources = room.find(FIND_SOURCES);

    if (lairs.length === 0) {
        return { error: "В комнате не найдено ни одного логова." };
    }

    return keepers.map((keeper, index) => {
        const source = keeper.pos.findClosestByRange(sources);
        const lair = keeper.pos.findClosestByRange(lairs);

        const result = {
            number: index + 1,
            keeper: getPositionData(keeper.pos),
            source: source ? getPositionData(source.pos) : null,
            lair: getPositionData(lair.pos)
        };

        const direction = getDirectionVector(
            lair.pos,
            keeper.pos
        );

        result.direction = direction;

        // Ищем огневую позицию на расстоянии 3 клеток.
        const firePos = findStandablePosition(
            room,
            getForwardCandidates(keeper.pos, direction, 3)
        );

        if (!firePos) {
            result.error = "Не найдена подходящая огневая позиция.";
            return result;
        }

        result.fire = getPositionData(firePos);

        // База — ещё 2 клетки от Keeper через огневую позицию.
        const basePos = findStandablePosition(
            room,
            getForwardCandidates(firePos, direction, 2)
        );

        if (!basePos) {
            result.error = "Не найдена подходящая база отступления.";
            return result;
        }

        result.base = getPositionData(basePos);

        return result;
    });
}


function findHealerBase2Positions(
    room,
    base1Pos,
    base2Pos,
    count,
    reservedSpots = []
) {
    // Строим маршрут от базы 1 до базы 2.
    const result = PathFinder.search(
        base1Pos,
        { pos: base2Pos, range: 0 },
        {
            maxRooms: 1,
            plainCost: 1,
            swampCost: 5
        }
    );

    if (result.incomplete) {
        return [];
    }

    const route = [
        base1Pos,
        ...result.path,
        base2Pos
    ];

    const routeKeys = new Set(
        route.map(pos => pos.x + "," + pos.y)
    );

    // Не используем позиции, уже назначенные у базы 1.
    const reservedKeys = new Set(
        reservedSpots.map(pos => pos.x + "," + pos.y)
    );

    const candidates = [];

    // Ищем клетки вплотную к базе 2.
    for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
            if (dx === 0 && dy === 0) {
                continue;
            }

            const x = base2Pos.x + dx;
            const y = base2Pos.y + dy;

            if (x < 0 || x > 49 || y < 0 || y > 49) {
                continue;
            }

            const key = x + "," + y;

            // Не перекрываем путь стрелка и не повторяем
            // позиции хиллеров у базы 1.
            if (routeKeys.has(key) || reservedKeys.has(key)) {
                continue;
            }

            const point = { x, y };

            if (!isStandable(room, point)) {
                continue;
            }

            // Не назначаем клетку, занятую другим крипом.
            if (room.lookForAt(LOOK_CREEPS, x, y).length > 0) {
                continue;
            }

            // Проверяем остальные объекты на клетке.
            const objects = room.lookAt(x, y);

            const blockedByObject = objects.some(object =>
                object.type === "source" ||
                object.type === "mineral" ||
                object.type === "controller" ||
                object.type === "deposit"
            );

            if (blockedByObject) {
                continue;
            }

            candidates.push(new RoomPosition(x, y, room.name));
        }
    }

    // Предпочитаем клетки, максимально удалённые от маршрута.
    const distanceToRoute = pos =>
        Math.min(...route.map(step =>
            Math.max(
                Math.abs(pos.x - step.x),
                Math.abs(pos.y - step.y)
            )
        ));

    // Раз в 25 тиков показываем клетки с историческим штрафом.
    if (Game.time % 25 === 0) {
        const penalized = candidates.filter(c => c.penalty > 0);

        for (const candidate of penalized) {
            console.log(
                `[ХИЛЛЕР] Клетка ${candidate.pos.x},${candidate.pos.y}` +
                ` — штраф ${candidate.penalty},` +
                ` расстояние до Keeper: ${candidate.keeperRange}`
            );
        }
    }

    // Сначала выбираем клетки с меньшим историческим штрафом.
    // При одинаковом штрафе предпочитаем клетки подальше от Keeper,
    // затем — подальше от маршрута отступления.
    candidates.sort((a, b) => {
        return (
            a.penalty - b.penalty ||
            b.keeperRange - a.keeperRange ||
            distanceToRoute(b.pos) - distanceToRoute(a.pos)
        );
    });

    return candidates
        .slice(0, count)
        .map(pos => getPositionData(pos));
}


function getPositionData(pos) {
    return {
        x: pos.x,
        y: pos.y,
        roomName: pos.roomName
    };
}


// Определяем одно из восьми основных направлений
// от логова к Source Keeper.
function getDirectionVector(lair, keeper) {
    const dx = keeper.x - lair.x;
    const dy = keeper.y - lair.y;

    const absX = Math.abs(dx);
    const absY = Math.abs(dy);

    if (absX > absY * 2.4) {
        return {
            dx: Math.sign(dx),
            dy: 0
        };
    }

    if (absY > absX * 2.4) {
        return {
            dx: 0,
            dy: Math.sign(dy)
        };
    }

    return {
        dx: Math.sign(dx),
        dy: Math.sign(dy)
    };
}


// Создаём три кандидата в заданном направлении:
// центральную клетку и две боковые.
//
// Для стрелка distance = 3.
// Для базы distance = 2.

function getForwardCandidates(origin, direction, distance) {
    const candidates = [];

    for (let dx = -distance; dx <= distance; dx++) {
        for (let dy = -distance; dy <= distance; dy++) {
            // Проверяем только клетки на нужной дистанции.
            if (Math.max(Math.abs(dx), Math.abs(dy)) !== distance) {
                continue;
            }

            let lateral;
            let forward;

            if (direction.dx === 0) {
                // Движение строго вверх или вниз.
                forward = dy * direction.dy;
                lateral = Math.abs(dx);

            } else if (direction.dy === 0) {
                // Движение строго влево или вправо.
                forward = dx * direction.dx;
                lateral = Math.abs(dy);

            } else {
                // Диагональ: клетка должна быть впереди
                // и находиться в том же общем направлении.
                const alongX = dx * direction.dx;
                const alongY = dy * direction.dy;

                if (alongX <= 0 || alongY <= 0) {
                    continue;
                }

                forward = Math.min(alongX, alongY);
                lateral = Math.abs(alongX - alongY);
            }

            // Не рассматриваем клетки позади или слишком сбоку.
            if (forward <= 0 || lateral > distance - 1) {
                continue;
            }

            candidates.push({
                x: origin.x + dx,
                y: origin.y + dy,
                lateral,
                forward
            });
        }
    }

    // Сначала проверяем клетки ближе к центральному направлению.
    candidates.sort((a, b) =>
        a.lateral - b.lateral || b.forward - a.forward
    );

    return candidates.map(({ x, y }) => ({ x, y }));
}



// Проверяем, можно ли использовать клетку
// как постоянную позицию стрелка.

function getPositionProblem(room, point) {
    if (
        point.x < 0 || point.x > 49 ||
        point.y < 0 || point.y > 49
    ) {
        return "за пределами комнаты";
    }

    const terrain = room.getTerrain().get(point.x, point.y);

    if (terrain & TERRAIN_MASK_WALL) {
        return "стена";
    }

    if (terrain & TERRAIN_MASK_SWAMP) {
        return "болото";
    }

    const structures = room.lookForAt(
        LOOK_STRUCTURES,
        point.x,
        point.y
    );

    const blocker = structures.find(structure => {
        if (
            structure.structureType === STRUCTURE_ROAD ||
            structure.structureType === STRUCTURE_CONTAINER
        ) {
            return false;
        }

        if (structure.structureType === STRUCTURE_RAMPART) {
            return !structure.my && !structure.isPublic;
        }

        return true;
    });

    if (blocker) {
        return "занято структурой " + blocker.structureType;
    }

    return null;
}

function isStandable(room, point) {
    return getPositionProblem(room, point) === null;
}



// Выбираем первую подходящую клетку.
// Центральная проверяется раньше боковых.
function findStandablePosition(room, candidates) {
    for (const point of candidates) {
        if (isStandable(room, point)) {
            return new RoomPosition(
                point.x,
                point.y,
                room.name
            );
        }
    }

    return null;
}


function findBasePair(room, firePos, originalDirection) {
    // Восемь направлений на карте Screeps.
    const directions = [
        { dx: 1, dy: 0 },
        { dx: 1, dy: 1 },
        { dx: 0, dy: 1 },
        { dx: -1, dy: 1 },
        { dx: -1, dy: 0 },
        { dx: -1, dy: -1 },
        { dx: 0, dy: -1 },
        { dx: 1, dy: -1 }
    ];

    const primaryIndex = directions.findIndex(
        d =>
            d.dx === originalDirection.dx &&
            d.dy === originalDirection.dy
    );

    if (primaryIndex === -1) {
        return null;
    }

    // Сначала первоначальное направление,
    // затем два соседних направления.
    const alternatives = [
        directions[primaryIndex],
        directions[(primaryIndex + 1) % 8],
        directions[(primaryIndex + 7) % 8]
    ];

    for (const direction of alternatives) {
        const firstCandidates = getForwardCandidates(
            firePos,
            direction,
            2
        );

        // Проверяем все варианты первой базы.
        for (const first of firstCandidates) {
            if (!isStandable(room, first)) {
                continue;
            }

            const firstPos = new RoomPosition(
                first.x,
                first.y,
                room.name
            );

            // Вторая база должна продолжать то же направление.
            const secondCandidates = getForwardCandidates(
                firstPos,
                direction,
                2
            );

            const secondPos = findStandablePosition(
                room,
                secondCandidates
            );

            // Возвращаем только полноценную пару.
            if (secondPos) {
                return {
                    base: firstPos,
                    base2: secondPos,
                    direction: direction
                };
            }
        }
    }

    return null;
}



function findHealerPositions(room, firePos, basePos, base2Pos, count) {
    // Маршрут 1: огневая позиция -> база 1.
    const firstPath = PathFinder.search(
        firePos,
        { pos: basePos, range: 0 },
        {
            maxRooms: 1,
            plainCost: 1,
            swampCost: 5
        }
    );

    if (firstPath.incomplete) {
        return [];
    }

    // Маршрут 2: база 1 -> база 2.
    const secondPath = PathFinder.search(
        basePos,
        { pos: base2Pos, range: 0 },
        {
            maxRooms: 1,
            plainCost: 1,
            swampCost: 5
        }
    );

    if (secondPath.incomplete) {
        return [];
    }

    // Объединяем оба маршрута.
    const route = [
        firePos,
        ...firstPath.path,
        basePos,
        ...secondPath.path,
        base2Pos
    ];

    const routeKeys = new Set(
        route.map(pos => pos.x + "," + pos.y)
    );

    const candidates = [];

    // Ищем свободные клетки вокруг базы 1.
    for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
            if (dx === 0 && dy === 0) {
                continue;
            }

            const x = basePos.x + dx;
            const y = basePos.y + dy;

            if (x < 0 || x > 49 || y < 0 || y > 49) {
                continue;
            }

            // Не занимаем клетки ни одного маршрута.
            if (routeKeys.has(x + "," + y)) {
                continue;
            }

            const point = { x, y };

            if (!isStandable(room, point)) {
                continue;
            }

            // Не занимаем клетку, на которой уже стоит крип.
            if (room.lookForAt(LOOK_CREEPS, x, y).length > 0) {
                continue;
            }

            const objects = room.lookAt(x, y);

            const hasObstacleObject = objects.some(object =>
                object.type === "source" ||
                object.type === "mineral" ||
                object.type === "controller" ||
                object.type === "deposit"
            );

            if (hasObstacleObject) {
                continue;
            }

            candidates.push(new RoomPosition(x, y, room.name));
        }
    }

    // Предпочитаем клетки подальше от обоих маршрутов.
    candidates.sort((a, b) => {
        const distanceToRoute = pos =>
            Math.min(...route.map(step =>
                Math.max(
                    Math.abs(pos.x - step.x),
                    Math.abs(pos.y - step.y)
                )
            ));

        return distanceToRoute(b) - distanceToRoute(a);
    });

    return candidates
        .slice(0, count)
        .map(pos => getPositionData(pos));
}

// функцию поиска позиций хиллеров возле огневой позиции
function findHealerFirePositions(
    room,
    firePos,
    base1Pos,
    keeperPos,
    count,
    reservedSpots = [],
    positionHistory = {}
) {
    console.log(
        "[ХИЛЛЕР DEBUG] Вызов функции. " +
        "Тик: " + Game.time +
        ", клеток в истории: " + Object.keys(positionHistory).length
    );

    const result = PathFinder.search(
        firePos,
        { pos: base1Pos, range: 0 },
        {
            maxRooms: 1,
            plainCost: 1,
            swampCost: 5,
            roomCallback(roomName) {
                if (roomName !== room.name) return false;

                const costs = new PathFinder.CostMatrix();

                for (const structure of room.find(FIND_STRUCTURES)) {
                    const x = structure.pos.x;
                    const y = structure.pos.y;

                    if (structure.structureType === STRUCTURE_ROAD) {
                        if (costs.get(x, y) < 255) {
                            costs.set(x, y, 1);
                        }
                    } else if (
                        structure.structureType === STRUCTURE_CONTAINER
                    ) {
                        continue;
                    } else if (
                        structure.structureType === STRUCTURE_RAMPART &&
                        (structure.my || structure.isPublic)
                    ) {
                        continue;
                    } else if (
                        OBSTACLE_OBJECT_TYPES.includes(
                            structure.structureType
                        )
                    ) {
                        costs.set(x, y, 255);
                    }
                }

                return costs;
            }
        }
    );

    if (result.incomplete) return [];

    const route = [firePos, ...result.path, base1Pos];

    const routeKeys = new Set(
        route.map(pos => pos.x + "," + pos.y)
    );

    const reservedKeys = new Set(
        reservedSpots.map(pos => pos.x + "," + pos.y)
    );

    const candidates = [];

    // Рассматриваем только соседние клетки стрелка.
    for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
            if (dx === 0 && dy === 0) continue;

            const x = firePos.x + dx;
            const y = firePos.y + dy;

            if (x < 0 || x > 49 || y < 0 || y > 49) continue;

            const key = x + "," + y;

            // Не занимаем путь стрелка и другие назначенные позиции.
            if (routeKeys.has(key) || reservedKeys.has(key)) continue;

            // Source Keeper опасен для дальних целей в радиусе 3.
            if (keeperPos.getRangeTo(x, y) <= 3) continue;

            const point = { x, y };

            if (!isStandable(room, point)) continue;

            const occupants = room.lookForAt(LOOK_CREEPS, x, y);

            // Клетку может уже занимать хиллер нашего отряда,
            // который затем перейдёт на другую назначенную позицию.
            const occupiedByOther = occupants.some(creep =>
                !(
                    creep.my &&
                    creep.memory.role === "attackerHealer"
                )
            );

            if (occupiedByOther) continue;

            const objects = room.lookAt(x, y);

            const hasObstacleObject = objects.some(object =>
                object.type === "source" ||
                object.type === "mineral" ||
                object.type === "controller" ||
                object.type === "deposit"
            );

            if (hasObstacleObject) continue;

            const pos = new RoomPosition(x, y, room.name);

            candidates.push({
                pos,
                keeperRange: keeperPos.getRangeTo(pos),
                penalty: positionHistory[key] || 0
            });
        }
    }

    // Сначала предпочитаем клетки подальше от Keeper,
    // затем — подальше от маршрута отступления.
    const distanceToRoute = pos =>
        Math.min(...route.map(step =>
            Math.max(
                Math.abs(pos.x - step.x),
                Math.abs(pos.y - step.y)
            )
        ));

    const penalized = candidates.filter(
        candidate => candidate.penalty > 0
    );

    console.log(
        "[ХИЛЛЕР DEBUG] Кандидатов: " + candidates.length +
        ", со штрафом: " + penalized.length
    );

    for (const candidate of penalized) {
        console.log(
            "[ХИЛЛЕР DEBUG] Клетка " +
            candidate.pos.x + "," + candidate.pos.y +
            " — штраф " + candidate.penalty
        );
    }

    // Высокий текущий радиус от Keeper повышает приоритет.
    // Исторически опасные клетки получают штраф.
    candidates.sort((a, b) => {
        const scoreA = a.keeperRange - a.penalty * 1.25;
        const scoreB = b.keeperRange - b.penalty * 1.25;

        return (
            scoreB - scoreA ||
            a.penalty - b.penalty ||
            distanceToRoute(b.pos) - distanceToRoute(a.pos)
        );
    });

    return candidates
        .slice(0, count)
        .map(candidate => getPositionData(candidate.pos));
}



module.exports = {

    role: "attacker",
    desiredCount: 1,

    healerRole: "attackerHealer",
    healerDesiredCount: 2,

    // Пустая строка отключает создание стрелка.
    targetRoom: "E26N55",
    previewOnly: false,

    // Стрелок: 10 TOUGH, 8 MOVE, 5 RANGED_ATTACK.
    body: [
        TOUGH, TOUGH, TOUGH, TOUGH, TOUGH,
        TOUGH, TOUGH, TOUGH, TOUGH, TOUGH,

        MOVE, MOVE, MOVE, MOVE,
        MOVE, MOVE, MOVE, MOVE,

        RANGED_ATTACK, RANGED_ATTACK, RANGED_ATTACK,
        RANGED_ATTACK, RANGED_ATTACK
    ],

    // Каждый хиллер: 4 MOVE и 4 HEAL.
    healerBody: [
        MOVE, HEAL,
        MOVE, HEAL,
        MOVE, HEAL,
        MOVE, HEAL
    ],


    // Пока управляем созданием только самого стрелка.
    // Создание и поведение хиллеров добавим отдельно.

    manageSpawning(spawn) {
        if (!this.targetRoom || !spawn) {
            return;
        }

        // Режим проверки: только расчёт, без создания стрелка.
        if (this.previewOnly) {
            const room = Game.rooms[this.targetRoom];

            if (!room) {
                const message =
                    "Комната " + this.targetRoom +
                    " сейчас не видна. Нужен обзор комнаты.";

                if (Memory.attackerPreviewStatus !== message) {
                    console.log("[attacker preview] " + message);
                    Memory.attackerPreviewStatus = message;
                }

                return;
            }


            const plans = calculatePositionPlans(room);

            if (plans.error) {
                const message = room.name + ": " + plans.error;

                if (Memory.attackerPreviewStatus !== message) {
                    console.log("[attacker preview] " + message);
                    Memory.attackerPreviewStatus = message;
                }

                return;
            }

            const signature = JSON.stringify(plans);

            if (Memory.attackerPreviewSignature !== signature) {
                console.log(
                    "[attacker preview] Комната: " +
                    room.name +
                    ", обнаружено Source Keeper: " +
                    plans.length
                );

                for (const plan of plans) {
                    console.log(
                        "[attacker preview] === Цель " +
                        plan.number + " ==="
                    );

                    console.log(
                        "[attacker preview] Ближайший источник: " +
                        (plan.source
                            ? plan.source.x + "," + plan.source.y
                            : "не найден")
                    );

                    console.log(
                        "[attacker preview] Keeper: " +
                        plan.keeper.x + "," + plan.keeper.y
                    );

                    console.log(
                        "[attacker preview] Логово: " +
                        plan.lair.x + "," + plan.lair.y
                    );

                    console.log(
                        "[attacker preview] Направление: dx=" +
                        plan.direction.dx +
                        ", dy=" + plan.direction.dy
                    );

                    if (plan.fire) {
                        console.log(
                            "[attacker preview] Огневая позиция: " +
                            plan.fire.x + "," + plan.fire.y
                        );
                    }

                    if (plan.base) {
                        console.log(
                            "[attacker preview] База отступления: " +
                            plan.base.x + "," + plan.base.y
                        );
                    }

                    if (plan.error) {
                        console.log(
                            "[attacker preview] Внимание: " + plan.error
                        );
                    }
                }

                Memory.attackerPreviewSignature = signature;
                Memory.attackerPreviewStatus = "Расчёт выполнен.";
            }

            return;

        }


        // Обычный режим создания стрелка.
        if (spawn.spawning) {
            return;
        }

        const allCreeps = Object.values(Game.creeps);

        const attackers = allCreeps.filter(
            creep =>
                creep.memory.role === this.role &&
                !creep.memory.attackerReserve
        );

        const attackerReserves = allCreeps.filter(
            creep =>
                creep.memory.role === this.role &&
                creep.memory.attackerReserve
        );

        // Первичное создание стрелка, если нет ни действующего,
        // ни резервного.
        if (
            attackers.length < this.desiredCount &&
            attackerReserves.length === 0
        ) {
            const name = "Attacker_" + Game.time;

            const result = spawn.spawnCreep(
                this.body,
                name,
                {
                    memory: {
                        role: this.role,
                        targetRoom: this.targetRoom,
                        homeRoomName: spawn.room.name
                    }
                }
            );

            if (result === OK) {
                console.log(
                    "[ATTACKER] Создан основной стрелок: " + name
                );
            }

            return;
        }

        // Плановая замена стрелка за 80 тиков до смерти.
        const agingAttacker = attackers.find(creep =>
            !creep.spawning &&
            Number.isFinite(creep.ticksToLive) &&
            creep.ticksToLive <= 80 &&
            !attackerReserves.some(
                reserve =>
                    reserve.memory.replacementFor === creep.name
            )
        );

        if (agingAttacker) {
            const name = "AttackerReserve_" + Game.time;

            const result = spawn.spawnCreep(
                this.body,
                name,
                {
                    memory: {
                        role: this.role,
                        targetRoom: this.targetRoom,
                        homeRoomName: spawn.room.name,
                        attackerReserve: true,
                        replacementFor: agingAttacker.name,
                        reserveSnapshot: {
                            attackerPositions: JSON.parse(
                                JSON.stringify(
                                    agingAttacker.memory.attackerPositions || {}
                                )
                            ),
                            lastPos: getPositionData(agingAttacker.pos)
                        }
                    }
                }
            );

            if (result === OK) {
                console.log(
                    "[ATTACKER] Создан резерв для " +
                    agingAttacker.name + ": " + name
                );
            }

            // Сначала пытаемся создать резервного стрелка.
            return;
        }

        const healers = allCreeps.filter(
            creep =>
                creep.memory.role === this.healerRole &&
                !creep.memory.healerReserve
        );

        const healerReserves = allCreeps.filter(
            creep =>
                creep.memory.role === this.healerRole &&
                creep.memory.healerReserve
        );

        // Первичное создание недостающего хиллера.
        if (healers.length < this.healerDesiredCount) {
            if (healerReserves.length === 0) {
                const usedSlots = new Set(
                    healers.map(creep => creep.memory.healerSlot)
                );

                let slot = 0;

                while (
                    usedSlots.has(slot) &&
                    slot < this.healerDesiredCount
                ) {
                    slot++;
                }

                if (slot < this.healerDesiredCount) {
                    const name =
                        "AttackerHealer_" + slot + "_" + Game.time;

                    const result = spawn.spawnCreep(
                        this.healerBody,
                        name,
                        {
                            memory: {
                                role: this.healerRole,
                                healerSlot: slot,
                                targetRoom: this.targetRoom,
                                homeRoomName: spawn.room.name
                            }
                        }
                    );

                    if (result === OK) {
                        console.log(
                            "[ATTACKER] Создан хиллер: " + name
                        );
                    }
                }
            }

            return;
        }

        // Ищем хиллера, которому осталось 40 тиков жизни.
        // Для каждого старого хиллера создаётся только один резерв.
        const agingHealer = healers.find(creep =>
            !creep.spawning &&
            Number.isFinite(creep.ticksToLive) &&
            creep.ticksToLive <= 40 &&
            !healerReserves.some(
                reserve =>
                    reserve.memory.replacementFor === creep.name
            )
        );

        if (!agingHealer) {
            return;
        }

        const slot = Number.isInteger(agingHealer.memory.healerSlot)
            ? agingHealer.memory.healerSlot
            : 0;

        const name =
            "AttackerHealerReserve_" + slot + "_" + Game.time;

        const result = spawn.spawnCreep(
            this.healerBody,
            name,
            {
                memory: {
                    role: this.healerRole,
                    healerSlot: slot,
                    targetRoom: this.targetRoom,
                    homeRoomName: spawn.room.name,
                    healerReserve: true,
                    replacementFor: agingHealer.name,
                    reserveSnapshot: {
                        healerSlot: slot,
                        healerPositions: JSON.parse(
                            JSON.stringify(
                                agingHealer.memory.healerPositions || {}
                            )
                        ),
                        lastPos: getPositionData(agingHealer.pos)
                    }
                }
            }
        );

        if (result === OK) {
            console.log(
                "[ATTACKER] Создан резерв для хиллера " +
                agingHealer.name + ": " + name
            );
        }
    },




    runAttackerHealer(creep) {
        if (this.previewOnly || creep.spawning || !this.targetRoom) {
            return;
        }



        // Резервный хиллер только движется в целевую комнату
        // и обновляет снимок состояния старого хиллера.
        if (creep.memory.healerReserve) {
            const oldName = creep.memory.replacementFor;
            const oldHealer = oldName && Game.creeps[oldName];

            if (oldHealer) {
                creep.memory.reserveSnapshot = {
                    healerSlot: oldHealer.memory.healerSlot,
                    healerPositions: JSON.parse(
                        JSON.stringify(
                            oldHealer.memory.healerPositions || {}
                        )
                    ),
                    lastPos: getPositionData(oldHealer.pos)
                };

                if (creep.room.name !== this.targetRoom) {
                    creep.moveTo(
                        new RoomPosition(25, 25, this.targetRoom),
                        { reusePath: 20 }
                    );
                } else if (!creep.memory.reserveWaitingLogged) {
                    console.log(
                        "[ATTACKER] Резервный хиллер " + creep.name +
                        " прибыл в комнату и ожидает смерти " +
                        oldHealer.name
                    );

                    creep.memory.reserveWaitingLogged = true;
                }

                return;
            }

            // Старый хиллер умер. Дожидаемся целевой комнаты.
            if (creep.room.name !== this.targetRoom) {
                creep.moveTo(
                    new RoomPosition(25, 25, this.targetRoom),
                    { reusePath: 20 }
                );
                return;
            }

            const snapshot = creep.memory.reserveSnapshot || {};
            const oldMemory =
                Memory.creeps && Memory.creeps[oldName];

            const oldPositions =
                snapshot.healerPositions ||
                (oldMemory && oldMemory.healerPositions);

            const oldSlot =
                Number.isInteger(snapshot.healerSlot)
                    ? snapshot.healerSlot
                    : oldMemory && oldMemory.healerSlot;

            const lastPos =
                snapshot.lastPos ||
                (oldMemory && oldMemory.lastPos) ||
                null;

            if (Number.isInteger(oldSlot)) {
                creep.memory.healerSlot = oldSlot;
            }

            if (oldPositions) {
                creep.memory.healerPositions = JSON.parse(
                    JSON.stringify(oldPositions)
                );
            }

            if (
                lastPos &&
                lastPos.roomName === this.targetRoom
            ) {
                creep.memory.takeoverPosition = lastPos;
            }

            delete creep.memory.healerReserve;
            delete creep.memory.replacementFor;
            delete creep.memory.reserveSnapshot;
            delete creep.memory.reserveWaitingLogged;

            console.log(
                "[ATTACKER] Резервный хиллер " + creep.name +
                " активирован. Прежний хиллер: " + oldName
            );
        }

        // Находим своего стрелка.
        const attacker = Object.values(Game.creeps).find(
            c =>
                c.memory.role === this.role &&
                !c.memory.attackerReserve
        );

        if (!attacker) {
            return;
        }

        // Хиллеры тоже должны попасть в целевую комнату.
        if (creep.room.name !== this.targetRoom) {
            creep.moveTo(
                new RoomPosition(25, 25, this.targetRoom),
                { reusePath: 20 }
            );
            return;
        }

        creep.memory.lastPos = getPositionData(creep.pos);

        const points = attacker.memory.attackerPositions;

        // Ждём, пока стрелок вычислит позиции.
        if (
            !points ||
            points.roomName !== this.targetRoom ||
            !Array.isArray(points.healerSpots) ||
            points.healerSpots.length < this.healerDesiredCount
        ) {
            return;
        }

        // Каждому хиллеру назначается отдельный номер: 0 или 1.
        let slot = creep.memory.healerSlot;

        if (
            !Number.isInteger(slot) ||
            slot < 0 ||
            slot >= this.healerDesiredCount
        ) {
            const usedSlots = new Set(
                Object.values(Game.creeps)
                    .filter(c =>
                        c.memory.role === this.healerRole &&
                        c.name !== creep.name
                    )
                    .map(c => c.memory.healerSlot)
            );

            slot = 0;

            while (
                usedSlots.has(slot) &&
                slot < this.healerDesiredCount
            ) {
                slot++;
            }

            if (slot >= this.healerDesiredCount) {
                return;
            }

            creep.memory.healerSlot = slot;
        }


        const base1Spot = points.healerSpots &&
            points.healerSpots[slot];

        const base2Spot = points.healerBase2Spots &&
            points.healerBase2Spots[slot];

        const fireSpot = points.healerFireSpots &&
            points.healerFireSpots[slot];

        if (!base1Spot) {
            return;
        }

        // Если стрелок отступает на базу 2, ждём её позиции,
        // если они пока не рассчитаны.
        if (points.phase === "base2" && !base2Spot) {
            if (!creep.memory.base2SpotWaitLogged) {
                console.log(
                    "[attacker healer " + creep.name +
                    "] Жду расчёта позиции у базы 2."
                );

                creep.memory.base2SpotWaitLogged = true;
            }

            return;
        }

        delete creep.memory.base2SpotWaitLogged;

        // Копируем обе позиции в личную память хиллера.
        // При изменении плана обновляем сохранённые координаты.
        const healerPositions = {
            fire: fireSpot ? {
                x: fireSpot.x,
                y: fireSpot.y,
                roomName: fireSpot.roomName
            } : null,
            base1: {
                x: base1Spot.x,
                y: base1Spot.y,
                roomName: base1Spot.roomName
            },
            base2: base2Spot ? {
                x: base2Spot.x,
                y: base2Spot.y,
                roomName: base2Spot.roomName
            } : null,
            version: points.healerBase2RoutePlanVersion || 0
        };

        if (
            JSON.stringify(creep.memory.healerPositions) !==
            JSON.stringify(healerPositions)
        ) {
            creep.memory.healerPositions = healerPositions;
        }


        // После замены сначала занимаем прежнюю клетку хиллера.
        if (creep.memory.takeoverPosition) {
            const takeoverPos = new RoomPosition(
                creep.memory.takeoverPosition.x,
                creep.memory.takeoverPosition.y,
                creep.memory.takeoverPosition.roomName
            );

            if (!creep.pos.isEqualTo(takeoverPos)) {
                creep.moveTo(takeoverPos, {
                    range: 0,
                    reusePath: 5
                });

                return;
            }

            delete creep.memory.takeoverPosition;
        }

        // Выбираем позицию в зависимости от фазы стрелка.
        let targetSpot;
        let targetMode;

        if (points.phase === "base2") {
            targetSpot = creep.memory.healerPositions.base2;
            targetMode = "base2";

        } else if (
            points.phase === "fire" &&
            creep.memory.healerPositions.fire
        ) {
            // Переходим к огневой позиции только тогда,
            // когда для хиллера рассчитана безопасная клетка.
            targetSpot = creep.memory.healerPositions.fire;
            targetMode = "fire";

        } else {
            // Если безопасная огневая позиция не найдена,
            // остаёмся на позиции возле базы 1.
            targetSpot = creep.memory.healerPositions.base1;
            targetMode = "base1";
        }

        if (!targetSpot) return;

        const targetPos = new RoomPosition(
            targetSpot.x,
            targetSpot.y,
            targetSpot.roomName
        );

        const spotKey =
            targetMode + " " +
            targetSpot.x + "," + targetSpot.y;

        if (creep.memory.reportedHealerSpot !== spotKey) {
            console.log(
                "[attacker healer " + creep.name +
                "] Назначена позиция: " + spotKey
            );

            creep.memory.reportedHealerSpot = spotKey;
        }

        // Двигаемся на позицию у текущей базы.
        if (!creep.pos.isEqualTo(targetPos)) {
            creep.moveTo(targetPos, { reusePath: 20 });
        }


        // Лечим себя, второго хиллера или стрелка.
        // Выбираем наиболее повреждённого по проценту здоровья.
        const healTargets = [
            attacker,
            ...Object.values(Game.creeps).filter(other =>
                other.memory.role === this.healerRole &&
                !other.memory.healerReserve &&
                !other.spawning &&
                other.room.name === creep.room.name
            )
        ];

        // Оставляем только повреждённых союзников
        // в пределах дальности лечения.
        const wounded = healTargets.filter(target =>
            target &&
            target.hits < target.hitsMax &&
            creep.pos.getRangeTo(target) <= 3
        );

        // При одинаковом проценте здоровья:
        // сначала лечим себя, затем стрелка, затем второго хиллера.
        const healPriority = target => {
            if (target.id === creep.id) return 0;
            if (target.id === attacker.id) return 1;
            return 2;
        };

        wounded.sort((a, b) =>
            (a.hits / a.hitsMax) - (b.hits / b.hitsMax) ||
            healPriority(a) - healPriority(b)
        );

        const target = wounded[0];

        if (target) {
            const range = creep.pos.getRangeTo(target);

            if (range <= 1) {
                creep.heal(target);
            } else {
                creep.rangedHeal(target);
            }
        }


    },




    runAttacker(creep) {
        if (this.previewOnly || creep.spawning || !this.targetRoom) {
            return;
        }


        // Резервный стрелок только идёт в целевую комнату
        // и копирует состояние действующего стрелка.
        // Пока прежний жив, он не участвует в боевой логике.
        if (creep.memory.attackerReserve) {
            const oldName = creep.memory.replacementFor;
            const oldAttacker = oldName && Game.creeps[oldName];

            if (oldAttacker) {
                const oldPoints =
                    oldAttacker.memory.attackerPositions;

                if (oldPoints) {
                    creep.memory.reserveSnapshot = {
                        attackerPositions: JSON.parse(
                            JSON.stringify(oldPoints)
                        ),
                        lastPos: getPositionData(oldAttacker.pos)
                    };
                }

                if (creep.room.name !== this.targetRoom) {
                    creep.moveTo(
                        new RoomPosition(25, 25, this.targetRoom),
                        { reusePath: 20 }
                    );
                } else if (!creep.memory.reserveWaitingLogged) {
                    console.log(
                        "[ATTACKER] Резерв " + creep.name +
                        " прибыл в комнату и ожидает смерти " +
                        oldAttacker.name
                    );

                    creep.memory.reserveWaitingLogged = true;
                }

                return;
            }

            // Старый стрелок уже умер.
            // Если резерв ещё не в целевой комнате — продолжаем путь.
            if (creep.room.name !== this.targetRoom) {
                creep.moveTo(
                    new RoomPosition(25, 25, this.targetRoom),
                    { reusePath: 20 }
                );
                return;
            }

            // Используем последнее сохранённое состояние.
            const snapshot = creep.memory.reserveSnapshot || {};
            const oldMemory =
                Memory.creeps && Memory.creeps[oldName];

            const savedPoints =
                snapshot.attackerPositions ||
                (oldMemory && oldMemory.attackerPositions);

            const lastPos =
                snapshot.lastPos ||
                (savedPoints && savedPoints.lastPos) ||
                null;

            if (savedPoints) {
                creep.memory.attackerPositions = JSON.parse(
                    JSON.stringify(savedPoints)
                );

                const inherited = creep.memory.attackerPositions;

                // Не считаем полное здоровье нового стрелка
                // повреждением относительно старого.
                inherited.lastHits = creep.hits;

                if (
                    lastPos &&
                    lastPos.roomName === this.targetRoom
                ) {
                    inherited.takeoverPosition = lastPos;
                }
            }

            delete creep.memory.attackerReserve;
            delete creep.memory.replacementFor;
            delete creep.memory.reserveSnapshot;
            delete creep.memory.reserveWaitingLogged;

            console.log(
                "[ATTACKER] Резерв " + creep.name +
                " активирован. Прежний стрелок: " + oldName
            );
        }


        // У каждого стрелка собственный набор координат.
        if (
            !creep.memory.attackerPositions ||
            creep.memory.attackerPositions.roomName !== this.targetRoom
        ) {
            creep.memory.attackerPositions = {
                roomName: this.targetRoom
            };
        }

        const points = creep.memory.attackerPositions;

        points.lastPos = getPositionData(creep.pos);

        // Однократно сбрасываем старый план,
        // чтобы заново дождаться остановки Keeper.
        if (points.keeperSettlementVersion !== 1) {
            const fieldsToReset = [
                "keeper",
                "keeperId",
                "keeperTracking",
                "lair",
                "lairId",
                "sourceId",
                "direction",
                "fire",
                "base",
                "base2",
                "baseDirection",
                "basePlanVersion",
                "healerSpots",
                "healerRoutePlanVersion",
                "healerBase2Spots",
                "healerBase2RoutePlanVersion",
                "healerFireSpots",
                "healerFireRoutePlanVersion",
                "healerFireThreatPosition",
                "phase",
                "reportedPlan"
            ];

            for (const field of fieldsToReset) {
                delete points[field];
            }

            points.keeperSettlementVersion = 1;
        }

        const previousHits = points.lastHits;

        const tookDamage =
            Number.isFinite(previousHits) &&
            creep.hits < previousHits;

        // Запоминаем здоровье для сравнения на следующем тике.
        points.lastHits = creep.hits;


        // 1. Сначала отправляем стрелка в целевую комнату.
        if (creep.room.name !== this.targetRoom) {
            creep.moveTo(
                new RoomPosition(25, 25, this.targetRoom),
                { reusePath: 20 }
            );
            return;
        }


        // 2. Выбираем ближайшее логово к стрелку.
        // Пока не знаем положение Keeper у шахты,
        // поэтому огневую позицию не рассчитываем.
        if (!points.lairId) {
            const lairs = creep.room.find(FIND_STRUCTURES, {
                filter: structure =>
                    structure.structureType === STRUCTURE_KEEPER_LAIR
            });

            const lair = creep.pos.findClosestByRange(lairs);

            if (!lair) {
                if (!points.lairErrorLogged) {
                    console.log(
                        "[attacker " + creep.name +
                        "] В комнате не найдено логово Source Keeper."
                    );
                    points.lairErrorLogged = true;
                }
                return;
            }

            points.lairId = lair.id;
            points.lair = getPositionData(lair.pos);

            console.log(
                "[attacker " + creep.name +
                "] Выбрано ближайшее логово: " +
                lair.id + " (" +
                lair.pos.x + "," + lair.pos.y + ")"
            );
        }

        const lair = Game.getObjectById(points.lairId);

        if (!lair || lair.structureType !== STRUCTURE_KEEPER_LAIR) {
            delete points.lairId;
            delete points.lair;
            return;
        }

        points.lair = getPositionData(lair.pos);

        // 3. Выбираем источник, который ближе всего к логову.
        if (!points.sourceId) {
            const sources = creep.room.find(FIND_SOURCES);
            const source = lair.pos.findClosestByRange(sources);

            if (!source) {
                return;
            }

            points.sourceId = source.id;

            console.log(
                "[attacker " + creep.name +
                "] Защищаемый источник: " +
                source.id + " (" +
                source.pos.x + "," + source.pos.y + ")"
            );
        }

        const source = Game.getObjectById(points.sourceId);

        if (!source) {
            delete points.sourceId;
            return;
        }

        // 4. Ждём Keeper именно выбранного логова.
        // Его первое появление у логова ещё не означает,
        // что он добрался до шахты.
        if (!points.keeper) {
            const expectedKeeperName = "Keeper" + points.lairId;

            const keepers = creep.room.find(FIND_HOSTILE_CREEPS, {
                filter: hostile =>
                    hostile.owner &&
                    hostile.owner.username === "Source Keeper"
            });

            const keeper = keepers.find(
                hostile => hostile.name === expectedKeeperName
            );

            if (!keeper) {
                if (!points.waitingForKeeperLogged) {
                    console.log(
                        "[attacker " + creep.name +
                        "] Ожидаю Keeper " + expectedKeeperName
                    );
                    points.waitingForKeeperLogged = true;
                }
                return;
            }

            points.keeperId = keeper.id;

            // Считаем, сколько тиков Keeper стоит на одном месте.
            const positionKey = keeper.pos.x + "," + keeper.pos.y;
            const tracking = points.keeperTracking;

            if (
                !tracking ||
                tracking.keeperId !== keeper.id ||
                tracking.positionKey !== positionKey
            ) {
                points.keeperTracking = {
                    keeperId: keeper.id,
                    positionKey: positionKey,
                    stableTicks: 1
                };
            } else {
                tracking.stableTicks++;
            }

            // Keeper должен быть рядом с шахтой и оставаться
            // на одной позиции минимум 3 последовательных тика.
            const keeperAtMine =
                keeper.pos.getRangeTo(source) <= 1;

            const keeperSettled =
                keeperAtMine &&
                points.keeperTracking.stableTicks >= 5;

            if (!keeperSettled) {
                const message =
                    "[attacker " + creep.name +
                    "] Keeper движется к шахте: " +
                    keeper.pos.x + "," + keeper.pos.y +
                    ", расстояние до источника: " +
                    keeper.pos.getRangeTo(source) +
                    ", неподвижен тиков: " +
                    points.keeperTracking.stableTicks;

                if (points.lastKeeperTrackingLog !== message) {
                    console.log(message);
                    points.lastKeeperTrackingLog = message;
                }

                return;
            }

            // Только теперь окончательно фиксируем позицию Keeper.
            points.keeper = getPositionData(keeper.pos);
            points.keeperId = keeper.id;

            delete points.keeperTracking;
            delete points.lastKeeperTrackingLog;
            delete points.waitingForKeeperLogged;

            console.log(
                "[attacker " + creep.name +
                "] Keeper добрался до шахты. Позиция зафиксирована: " +
                keeper.pos.x + "," + keeper.pos.y +
                ". Начинаю расчёт боевых позиций."
            );
        }

        // Используем только зафиксированную позицию.
        const keeperPos = new RoomPosition(
            points.keeper.x,
            points.keeper.y,
            points.keeper.roomName
        );

        // 3. Находим ближайшее к выбранному Keeper логово.
        if (!points.lair || !points.lairId) {
            const lairs = creep.room.find(FIND_STRUCTURES, {
                filter: structure =>
                    structure.structureType === STRUCTURE_KEEPER_LAIR
            });

            const lair = keeperPos.findClosestByRange(lairs);

            if (!lair) {
                if (!points.lairErrorLogged) {
                    console.log(
                        "[attacker " + creep.name +
                        "] Не найдено логово Source Keeper."
                    );
                    points.lairErrorLogged = true;
                }
                return;
            }

            points.lair = getPositionData(lair.pos);
            points.lairId = lair.id;
            points.lairErrorLogged = false;
        }

        // 4. Определяем направление от логова через Keeper.
        if (!points.direction) {
            points.direction = getDirectionVector(
                points.lair,
                points.keeper
            );
        }

        const direction = points.direction;

        // 5. Выбираем собственную огневую позицию стрелка.
        if (!points.fire) {
            const candidates = getForwardCandidates(
                keeperPos,
                direction,
                3
            );

            const firePos = findStandablePosition(
                creep.room,
                candidates
            );

            if (!firePos) {
                const details = candidates.map(point =>
                    point.x + "," + point.y + ": " +
                    getPositionProblem(creep.room, point)
                ).join("; ");

                if (points.lastFireError !== details) {
                    console.log(
                        "[attacker " + creep.name +
                        "] Не найдена огневая позиция. " + details
                    );
                    points.lastFireError = details;
                }

                return;
            }

            points.fire = getPositionData(firePos);
            delete points.lastFireError;
        }


        // 6. Пересчитываем старую базу при переходе
        // на новую версию алгоритма.
        if (points.basePlanVersion !== 2) {
            delete points.base;
            delete points.base2;
            delete points.baseDirection;

            points.basePlanVersion = 2;
            delete points.reportedPlan;
        }

        // Ищем сразу пару баз.
        if (!points.base || !points.base2) {
            const firePosition = new RoomPosition(
                points.fire.x,
                points.fire.y,
                points.fire.roomName
            );

            const pair = findBasePair(
                creep.room,
                firePosition,
                direction
            );

            if (pair) {
                points.base = getPositionData(pair.base);
                points.base2 = getPositionData(pair.base2);
                points.baseDirection = pair.direction;

                delete points.lastBasePairError;
            } else {
                if (!points.lastBasePairError) {
                    console.log(
                        "[attacker " + creep.name +
                        "] Не удалось найти две базы подряд. " +
                        "Пробую поиск повторно."
                    );
                    points.lastBasePairError = true;
                }

                // Не отправляем стрелка на огневую позицию.
                return;
            }
        }



        // Рассчитываем места для двух хиллеров.
        // Учитываем оба маршрута стрелка.
        // Версия 2 нужна для обновления ранее сохранённых позиций.
        if (
            points.healerRoutePlanVersion !== 2 ||
            !Array.isArray(points.healerSpots) ||
            points.healerSpots.length < this.healerDesiredCount
        ) {
            const firePosition = new RoomPosition(
                points.fire.x,
                points.fire.y,
                points.fire.roomName
            );

            const basePosition = new RoomPosition(
                points.base.x,
                points.base.y,
                points.base.roomName
            );

            const base2Position = new RoomPosition(
                points.base2.x,
                points.base2.y,
                points.base2.roomName
            );

            const spots = findHealerPositions(
                creep.room,
                firePosition,
                basePosition,
                base2Position,
                this.healerDesiredCount
            );

            if (spots.length >= this.healerDesiredCount) {
                points.healerSpots = spots;
                points.healerRoutePlanVersion = 2;

                delete points.healerSpotErrorLogged;

                console.log(
                    "[attacker " + creep.name +
                    "] Позиции хиллеров: " +
                    spots.map((p, i) =>
                        "H" + (i + 1) + " " + p.x + "," + p.y
                    ).join(" | ")
                );
            } else if (!points.healerSpotErrorLogged) {
                console.log(
                    "[attacker " + creep.name +
                    "] Пока не удалось найти две свободные позиции хиллеров."
                );

                points.healerSpotErrorLogged = true;
            }
        }


        // Рассчитываем позиции хиллеров у базы 2.
        // Версия 1 обозначает новый план размещения.
        if (
            points.healerBase2RoutePlanVersion !== 1 ||
            !Array.isArray(points.healerBase2Spots) ||
            points.healerBase2Spots.length < this.healerDesiredCount
        ) {
            const base1Position = new RoomPosition(
                points.base.x,
                points.base.y,
                points.base.roomName
            );

            const base2Position = new RoomPosition(
                points.base2.x,
                points.base2.y,
                points.base2.roomName
            );

            const spots = findHealerBase2Positions(
                creep.room,
                base1Position,
                base2Position,
                this.healerDesiredCount,
                points.healerSpots || []
            );

            if (spots.length >= this.healerDesiredCount) {
                points.healerBase2Spots = spots;
                points.healerBase2RoutePlanVersion = 1;

                delete points.healerBase2SpotErrorLogged;

                console.log(
                    "[attacker " + creep.name +
                    "] Позиции хиллеров у базы 2: " +
                    spots.map((p, i) =>
                        "H" + (i + 1) + " " + p.x + "," + p.y
                    ).join(" | ")
                );
            } else if (!points.healerBase2SpotErrorLogged) {
                console.log(
                    "[attacker " + creep.name +
                    "] Не удалось найти две свободные позиции хиллеров у базы 2."
                );

                points.healerBase2SpotErrorLogged = true;
            }
        }


        // 8. Рассчитываем позиции хиллеров возле огневой позиции.
        const liveKeeper = points.keeperId
            ? Game.getObjectById(points.keeperId)
            : null;

        const keeperPosition =
            liveKeeper && liveKeeper.room.name === creep.room.name
                ? liveKeeper.pos
                : new RoomPosition(
                    points.keeper.x,
                    points.keeper.y,
                    points.keeper.roomName
                );

        const keeperPositionKey = liveKeeper
            ? liveKeeper.pos.x + "," + liveKeeper.pos.y
            : "anchor";

        if (
            points.healerFireRoutePlanVersion !== 1 ||
            !Array.isArray(points.healerFireSpots) ||
            points.healerFireSpots.length < this.healerDesiredCount ||
            points.healerFireThreatPosition !== keeperPositionKey
        ) {
            // Запоминаем огневые клетки хиллеров,
            // которые оказались в радиусе 3 от Keeper.
            if (!points.healerFireSpotHistory) {
                points.healerFireSpotHistory = {};
            }

            if (
                liveKeeper &&
                Array.isArray(points.healerFireSpots)
            ) {
                for (const spot of points.healerFireSpots) {
                    const key = spot.x + "," + spot.y;
                    const range = keeperPosition.getRangeTo(
                        spot.x,
                        spot.y
                    );

                    if (range <= 3) {
                        const previousPenalty =
                            points.healerFireSpotHistory[key] || 0;

                        // Штраф накапливается, но ограничен двумя.
                        points.healerFireSpotHistory[key] =
                            Math.min(previousPenalty + 1, 2);

                        if (previousPenalty === 0) {
                            console.log(
                                "[attacker " + creep.name +
                                "] Клетка " + key +
                                " запомнена как опасная для хиллеров."
                            );
                        }
                    }
                }
            }
            delete points.healerFireSpots;

            const firePosition = new RoomPosition(
                points.fire.x,
                points.fire.y,
                points.fire.roomName
            );

            const base1Position = new RoomPosition(
                points.base.x,
                points.base.y,
                points.base.roomName
            );

            const reservedSpots = [
                ...(points.healerSpots || []),
                ...(points.healerBase2Spots || [])
            ];

            const spots = findHealerFirePositions(
                creep.room,
                firePosition,
                base1Position,
                keeperPosition,
                this.healerDesiredCount,
                reservedSpots,
                points.healerFireSpotHistory
            );

            if (spots.length >= this.healerDesiredCount) {
                points.healerFireSpots = spots;
                points.healerFireRoutePlanVersion = 1;
                points.healerFireThreatPosition = keeperPositionKey;

                delete points.healerFireSpotErrorLogged;

                console.log(
                    "[attacker " + creep.name +
                    "] Позиции хиллеров у огневой позиции: " +
                    spots.map((p, i) =>
                        "H" + (i + 1) + " " + p.x + "," + p.y
                    ).join(" | ")
                );
            } else if (!points.healerFireSpotErrorLogged) {
                console.log(
                    "[attacker " + creep.name +
                    "] Не удалось найти две безопасные позиции " +
                    "хиллеров у огневой позиции."
                );

                points.healerFireSpotErrorLogged = true;
            }
        }

        // 7. Выводим лог только при изменении выбранного плана.

        const report = [
            "Keeper: " + points.keeper.x + "," + points.keeper.y,
            "логово: " + points.lair.x + "," + points.lair.y,
            "огневая позиция: " +
            points.fire.x + "," + points.fire.y,
            "база 1: " +
            points.base.x + "," + points.base.y,
            "база 2: " +
            points.base2.x + "," + points.base2.y,
            "направление баз: dx=" +
            points.baseDirection.dx +
            ", dy=" + points.baseDirection.dy +
            " | хиллеры у огневой позиции: " +
            (points.healerFireSpots
                ? points.healerFireSpots.map((p, i) =>
                    "H" + (i + 1) + " " + p.x + "," + p.y
                ).join("; ")
                : "не найдены") +
            " | позиции хиллеров: " +
            (points.healerSpots
                ? points.healerSpots.map((p, i) =>
                    "H" + (i + 1) + " " + p.x + "," + p.y
                ).join("; ")
                : "пока не найдены")
        ].join(" | ");

        if (points.reportedPlan !== report) {
            console.log(
                "[attacker " + creep.name + "] " + report
            );
            points.reportedPlan = report;
        }




        const base1Pos = new RoomPosition(
            points.base.x,
            points.base.y,
            points.base.roomName
        );

        const base2Pos = new RoomPosition(
            points.base2.x,
            points.base2.y,
            points.base2.roomName
        );

        const firePos = new RoomPosition(
            points.fire.x,
            points.fire.y,
            points.fire.roomName
        );


        // После замены сначала занимаем последнюю клетку
        // предыдущего стрелка, затем продолжаем его фазу.
        if (points.takeoverPosition) {
            const takeoverPos = new RoomPosition(
                points.takeoverPosition.x,
                points.takeoverPosition.y,
                points.takeoverPosition.roomName
            );

            if (!creep.pos.isEqualTo(takeoverPos)) {
                creep.moveTo(takeoverPos, {
                    range: 0,
                    reusePath: 5
                });

                return;
            }

            delete points.takeoverPosition;
        }

        // Начинаем с базы 1.
        if (!points.phase) {
            points.phase = "base1";

            console.log(
                "[attacker " + creep.name +
                "] Начальная фаза: база 1."
            );
        }

        const changePhase = (nextPhase, reason) => {
            if (points.phase === nextPhase) {
                return;
            }

            const previousPhase = points.phase;
            points.phase = nextPhase;

            console.log(
                "[attacker " + creep.name + "] Фаза: " +
                previousPhase + " -> " + nextPhase +
                ". Причина: " + reason
            );
        };

        switch (points.phase) {

            // --------------------------------------------------
            // БАЗА 1
            // --------------------------------------------------
            case "base1": {

                // Сначала обязательно занимаем базу 1.
                if (!creep.pos.isEqualTo(base1Pos)) {
                    creep.moveTo(base1Pos, { reusePath: 20 });
                    return;
                }

                // Если на базе 1 здоровье уменьшилось,
                // отходим дальше — на базу 2.
                if (tookDamage) {
                    changePhase(
                        "base2",
                        "на базе 1 получены повреждения"
                    );

                    creep.moveTo(base2Pos, { reusePath: 20 });
                    return;
                }

                // На огневую позицию идём только с полным
                // здоровьем и при отсутствии нового урона.
                if (creep.hits === creep.hitsMax) {
                    changePhase(
                        "fire",
                        "здоровье полностью восстановлено"
                    );

                    creep.moveTo(firePos, { reusePath: 20 });
                    return;
                }

                // Пока восстанавливается — остаёмся на базе 1.
                return;
            }


            // --------------------------------------------------
            // БАЗА 2 — ДАЛЬНИЙ ОТХОД
            // --------------------------------------------------
            case "base2": {

                if (!creep.pos.isEqualTo(base2Pos)) {
                    creep.moveTo(base2Pos, { reusePath: 20 });
                    return;
                }

                // Остаёмся здесь, пока здоровье не станет
                // полным и повреждения не прекратятся.
                if (
                    creep.hits === creep.hitsMax &&
                    !tookDamage
                ) {
                    changePhase(
                        "fire",
                        "на базе 2 восстановлено полное здоровье"
                    );

                    creep.moveTo(firePos, { reusePath: 20 });
                    return;
                }

                return;
            }


            // --------------------------------------------------
            // ВОЗВРАЩЕНИЕ НА БАЗУ 1 ПОСЛЕ БОЯ
            // --------------------------------------------------
            case "retreatBase1": {

                if (!creep.pos.isEqualTo(base1Pos)) {
                    creep.moveTo(base1Pos, { reusePath: 20 });
                    return;
                }

                // Только после прибытия начинаем обычный
                // контроль повреждений на базе 1.
                changePhase(
                    "base1",
                    "стрелок достиг базы 1"
                );

                return;
            }


            // --------------------------------------------------
            // ОГНЕВАЯ ПОЗИЦИЯ
            // --------------------------------------------------
            case "fire": {

                // При здоровье ниже 50% немедленно возвращаемся
                // на базу 1 к хиллерам.
                if (creep.hits < creep.hitsMax * 0.5) {
                    changePhase(
                        "retreatBase1",
                        "здоровье ниже 50%"
                    );

                    creep.moveTo(base1Pos, { reusePath: 20 });
                    return;
                }

                // Удерживаем огневую позицию.
                if (!creep.pos.isEqualTo(firePos)) {
                    creep.moveTo(firePos, { reusePath: 20 });
                    return;
                }


                // Ищем Keeper именно того логова,
                // которое выбрал наш стрелок.
                const expectedKeeperName =
                    "Keeper" + points.lairId;

                let keeper = points.keeperId
                    ? Game.getObjectById(points.keeperId)
                    : null;

                // Старый объект мог погибнуть.
                // Проверяем, принадлежит ли он нужному логову.
                if (
                    !keeper ||
                    keeper.name !== expectedKeeperName
                ) {
                    const keepers = creep.room.find(
                        FIND_HOSTILE_CREEPS,
                        {
                            filter: hostile =>
                                hostile.owner &&
                                hostile.owner.username === "Source Keeper"
                        }
                    );

                    keeper = keepers.find(
                        hostile =>
                            hostile.name === expectedKeeperName
                    );

                    if (keeper) {
                        points.keeperId = keeper.id;
                        delete points.noKeeperLogged;

                        console.log(
                            "[attacker " + creep.name +
                            "] Найден новый Keeper: " +
                            keeper.name + ", ID: " + keeper.id
                        );
                    } else {
                        const visible = keepers.map(hostile =>
                            hostile.name + " (" +
                            hostile.pos.x + "," +
                            hostile.pos.y + ")"
                        ).join("; ");

                        const message =
                            "Ожидается " + expectedKeeperName +
                            ". Видимые Keeper: " +
                            (visible || "нет");

                        if (points.lastKeeperSearchLog !== message) {
                            console.log(
                                "[attacker " + creep.name +
                                "] " + message
                            );

                            points.lastKeeperSearchLog = message;
                        }

                        return;
                    }
                }

                delete points.lastKeeperSearchLog;

                // Проверяем дальность до нового Keeper.
                const range = creep.pos.getRangeTo(keeper);

                if (range > 3) {
                    const message =
                        "Keeper " + keeper.name +
                        " найден, но слишком далеко: " +
                        range + " клеток. Огневая позиция: " +
                        creep.pos.x + "," + creep.pos.y;

                    if (points.lastRangeLog !== message) {
                        console.log(
                            "[attacker " + creep.name +
                            "] " + message
                        );

                        points.lastRangeLog = message;
                    }

                    return;
                }

                delete points.lastRangeLog;

                // Стреляем по выбранному Keeper.
                const attackResult = creep.rangedAttack(keeper);

                if (attackResult !== OK) {
                    const message =
                        "Ошибка rangedAttack: " +
                        attackResult +
                        ", цель: " + keeper.name +
                        ", дальность: " + range;

                    if (points.lastAttackError !== message) {
                        console.log(
                            "[attacker " + creep.name +
                            "] " + message
                        );

                        points.lastAttackError = message;
                    }
                } else {
                    delete points.lastAttackError;
                }

                return;

            }


            // --------------------------------------------------
            // НЕИЗВЕСТНОЕ СОСТОЯНИЕ
            // --------------------------------------------------
            default: {
                points.phase = "base1";

                console.log(
                    "[attacker " + creep.name +
                    "] Неизвестная фаза. Возвращаюсь к базе 1."
                );

                creep.moveTo(base1Pos, { reusePath: 20 });
                return;
            }
        }
    },



};
