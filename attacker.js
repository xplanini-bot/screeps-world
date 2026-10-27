

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

        const attackers = Object.values(Game.creeps).filter(
            creep => creep.memory.role === this.role
        );

        if (attackers.length >= this.desiredCount) {
            return;
        }

        spawn.spawnCreep(
            this.body,
            `Attacker_${Game.time}`,
            {
                memory: {
                    role: this.role
                }
            }
        );
    },


    runAttackerHealer(creep) {
        // Временно отключено: поведение хиллеров
        // будет реализовано отдельно.
        return;
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
            ", dy=" + points.baseDirection.dy
        ].join(" | ");

        if (points.reportedPlan !== report) {
            console.log(
                "[attacker " + creep.name + "] " + report
            );
            points.reportedPlan = report;
        }



        // 8. Пока занимаем первую базу, а не огневую позицию.
        const basePos = new RoomPosition(
            points.base.x,
            points.base.y,
            points.base.roomName
        );

        if (!creep.pos.isEqualTo(basePos)) {
            creep.moveTo(basePos, { reusePath: 20 });
        }

    },


};
