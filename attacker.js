

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

    candidates.sort((a, b) =>
        distanceToRoute(b) - distanceToRoute(a)
    );

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

    // Каждый хиллер: 3 MOVE и 3 HEAL.
    healerBody: [
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
            creep => creep.memory.role === this.role
        );

        // Сначала создаём самого стрелка.
        if (attackers.length < this.desiredCount) {
            spawn.spawnCreep(
                this.body,
                `Attacker_${Game.time}`,
                {
                    memory: {
                        role: this.role
                    }
                }
            );

            return;
        }

        // Затем создаём недостающих хиллеров.
        const healers = allCreeps.filter(
            creep => creep.memory.role === this.healerRole
        );

        if (healers.length >= this.healerDesiredCount) {
            return;
        }

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

        if (slot >= this.healerDesiredCount) {
            return;
        }

        spawn.spawnCreep(
            this.healerBody,
            `AttackerHealer_${slot}_${Game.time}`,
            {
                memory: {
                    role: this.healerRole,
                    healerSlot: slot
                }
            }
        );

    },



    runAttackerHealer(creep) {
        if (this.previewOnly || creep.spawning || !this.targetRoom) {
            return;
        }

        // Находим своего стрелка.
        const attacker = Object.values(Game.creeps).find(
            c => c.memory.role === this.role
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

        // На базе 2 стрелок отступил от огневой позиции.
        // Во всех остальных фазах хиллер ждёт у базы 1.
        const targetSpot =
            points.phase === "base2"
                ? creep.memory.healerPositions.base2
                : creep.memory.healerPositions.base1;

        if (!targetSpot) {
            return;
        }

        const targetPos = new RoomPosition(
            targetSpot.x,
            targetSpot.y,
            targetSpot.roomName
        );

        const spotKey =
            (points.phase === "base2" ? "base2 " : "base1 ") +
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

        // Продолжаем лечить стрелка на маршруте или у базы.
        const range = creep.pos.getRangeTo(attacker);

        if (attacker.hits < attacker.hitsMax) {
            if (range <= 1) {
                creep.heal(attacker);
            } else if (range <= 3) {
                creep.rangedHeal(attacker);
            }
        }

    },




    runAttacker(creep) {
        if (this.previewOnly || creep.spawning || !this.targetRoom) {
            return;
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

        // 2. Выбираем ближайшего к самому стрелку Source Keeper.
        // Его исходную позицию сохраняем как опорную.
        if (!points.keeper) {
            const keepers = creep.room.find(FIND_HOSTILE_CREEPS, {
                filter: hostile =>
                    hostile.owner &&
                    hostile.owner.username === "Source Keeper"
            });

            const keeper = creep.pos.findClosestByRange(keepers);

            if (!keeper) {
                if (!points.waitingForKeeperLogged) {
                    console.log(
                        "[attacker " + creep.name +
                        "] В комнате нет видимого Source Keeper. Жду."
                    );
                    points.waitingForKeeperLogged = true;
                }
                return;
            }

            points.keeper = getPositionData(keeper.pos);
            points.keeperId = keeper.id;
            points.waitingForKeeperLogged = false;
        }

        const keeperPos = new RoomPosition(
            points.keeper.x,
            points.keeper.y,
            points.keeper.roomName
        );

        // 3. Находим ближайшее к выбранному Keeper логово.
        if (!points.lair) {
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

                // Пытаемся использовать сохранённую цель.
                let keeper = points.keeperId
                    ? Game.getObjectById(points.keeperId)
                    : null;

                // Если Keeper погиб и возродился с новым ID,
                // ищем ближайшего к первоначальному посту.
                if (
                    !keeper ||
                    !keeper.owner ||
                    keeper.owner.username !== "Source Keeper"
                ) {
                    const keepers = creep.room.find(
                        FIND_HOSTILE_CREEPS,
                        {
                            filter: hostile =>
                                hostile.owner &&
                                hostile.owner.username === "Source Keeper"
                        }
                    );

                    const keeperAnchor = new RoomPosition(
                        points.keeper.x,
                        points.keeper.y,
                        points.keeper.roomName
                    );

                    keeper = keeperAnchor.findClosestByRange(keepers);

                    if (keeper) {
                        points.keeperId = keeper.id;
                    }
                }

                // Если защитник пока не появился,
                // остаёмся на огневой позиции.
                if (!keeper) {
                    if (!points.noKeeperLogged) {
                        console.log(
                            "[attacker " + creep.name +
                            "] Source Keeper не найден. Жду на огневой позиции."
                        );

                        points.noKeeperLogged = true;
                    }

                    return;
                }

                delete points.noKeeperLogged;

                // Стреляем только в пределах дальности 3 клеток.
                if (creep.pos.getRangeTo(keeper) <= 3) {
                    creep.rangedAttack(keeper);
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
