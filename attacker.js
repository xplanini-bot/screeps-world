// Получение всех участников одного отряда
function getSquadMembers(squadId) {
    return Object.values(Game.creeps).filter(
        creep => creep.memory.squadId === squadId
    );
}

// Находим логово, которому соответствует Source Keeper
function getKeeperLairForKeeper(keeper) {
    const room = keeper.room;

    const lairs = room.find(FIND_STRUCTURES, {
        filter: structure =>
            structure.structureType === STRUCTURE_KEEPER_LAIR
    });

    if (lairs.length === 0) return null;

    // Source Keeper охраняет ближайший к нему ресурс
    const resources = [
        ...room.find(FIND_SOURCES),
        ...room.find(FIND_MINERALS)
    ];

    const resource = keeper.pos.findClosestByRange(resources);

    // Выбираем логово, ближайшее к охраняемому ресурсу
    if (resource) {
        return resource.pos.findClosestByRange(lairs);
    }

    // Запасной вариант
    return keeper.pos.findClosestByRange(lairs);
}

// Выбор ведущего хиллера при отступлении
function getRetreatLeader(members) {
    const healers = members
        .filter(member =>
            member.memory.role === "attackerHealer" &&
            !member.spawning
        )
        .sort((a, b) => a.name.localeCompare(b.name));

    return healers[0] || null;
}


// Подводим хиллера вплотную к стрелку для лечения
function moveHealerAdjacentToAttacker(creep, attacker, members) {
    if (!attacker) return;

    if (creep.pos.roomName !== attacker.pos.roomName) {
        creep.moveTo(attacker, {
            range: 1,
            reusePath: 3
        });
        return;
    }

    const candidates = [];

    for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
            if (dx === 0 && dy === 0) continue;

            const x = attacker.pos.x + dx;
            const y = attacker.pos.y + dy;

            if (x < 1 || x > 48 || y < 1 || y > 48) {
                continue;
            }

            if (
                attacker.room.getTerrain().get(x, y) ===
                TERRAIN_MASK_WALL
            ) {
                continue;
            }

            const pos = new RoomPosition(
                x,
                y,
                attacker.room.name
            );

            const structures = pos.lookFor(LOOK_STRUCTURES);

            if (structures.some(structure =>
                OBSTACLE_OBJECT_TYPES.includes(
                    structure.structureType
                )
            )) {
                continue;
            }

            // Не выбираем клетку, занятую другим крипом
            const occupied = pos.lookFor(LOOK_CREEPS).some(other =>
                other.id !== creep.id
            );

            if (occupied) continue;

            const path = creep.pos.findPathTo(pos, {
                range: 0,
                maxOps: 2000
            });

            if (!creep.pos.isEqualTo(pos) && path.length === 0) {
                continue;
            }

            candidates.push({
                pos,
                distance: creep.pos.getRangeTo(pos),
                pathLength: path.length
            });
        }
    }

    candidates.sort((a, b) =>
        a.distance - b.distance ||
        a.pathLength - b.pathLength
    );

    if (candidates.length === 0) {
        // Если свободную соседнюю клетку найти не удалось,
        // продолжаем пытаться подойти к стрелку
        creep.moveTo(attacker, {
            range: 1,
            reusePath: 0
        });

        return;
    }

    const destination = candidates[0].pos;

    if (!creep.pos.isEqualTo(destination)) {
        creep.moveTo(destination, {
            range: 0,
            reusePath: 0
        });
    }
}

// Проверяем, находятся ли хиллеры в радиусе 2 клеток от стрелка
function areHealersCloseToAttacker(attacker, members) {
    const healers = members.filter(member =>
        member.memory.role === "attackerHealer" &&
        !member.spawning
    );

    return healers.every(healer =>
        healer.pos.roomName === attacker.pos.roomName &&
        attacker.pos.getRangeTo(healer) <= 2
    );
}

// Определяем первый шаг, который планирует сделать стрелок
function getAttackerMoveVector(attacker, target, members) {
    const squadState =
        Memory.attackerSquads &&
        Memory.attackerSquads[attacker.memory.squadId];

    let destination = null;
    let range = 0;

    // При отступлении стрелок следует за ведущим хиллером
    if (
        squadState &&
        ["retreat", "keeperRetreat", "keeperHeal"].includes(
            squadState.mode
        )
    ) {
        const leader = getRetreatLeader(members);

        if (
            leader &&
            (
                leader.pos.roomName !== attacker.pos.roomName ||
                attacker.pos.getRangeTo(leader) > 1
            )
        ) {
            destination = leader;
            range = 1;
        }
    } else if (
        attacker.memory.targetRoom &&
        attacker.pos.roomName !== attacker.memory.targetRoom
    ) {
        // При переходе в атакующую комнату
        destination = new RoomPosition(
            25,
            25,
            attacker.memory.targetRoom
        );
        range = 0;
    } else if (
        target &&
        target.pos.roomName === attacker.pos.roomName &&
        attacker.pos.getRangeTo(target) > 3
    ) {
        // Во время наступления движемся к цели атаки
        destination = target;
        range = 3;
    }

    if (!destination) return null;

    const path = attacker.pos.findPathTo(destination, {
        range: range,
        maxOps: 2000
    });

    if (!path || path.length === 0) return null;

    // Направление Screeps: от TOP (1) до TOP_LEFT (8)
    const directions = [
        null,
        { dx: 0, dy: -1 },
        { dx: 1, dy: -1 },
        { dx: 1, dy: 0 },
        { dx: 1, dy: 1 },
        { dx: 0, dy: 1 },
        { dx: -1, dy: 1 },
        { dx: -1, dy: 0 },
        { dx: -1, dy: -1 }
    ];

    return directions[path[0].direction] || null;
}

// Хиллер занимает свободную позицию позади или сбоку от стрелка
function moveHealerBehindAttacker(creep, attacker, target, members) {
    if (!attacker) return;

    // Если стрелок уже в другой комнате, догоняем его
    if (creep.pos.roomName !== attacker.pos.roomName) {
        creep.moveTo(attacker, {
            range: 1,
            reusePath: 3
        });
        return;
    }

    const moveVector = getAttackerMoveVector(
        attacker,
        target,
        members
    );

    // Если стрелок не движется, предпочитаем сторону,
    // противоположную Source Keeper
    let awayX = 0;
    let awayY = 0;

    if (
        target &&
        target.pos.roomName === attacker.pos.roomName
    ) {
        awayX = Math.sign(attacker.pos.x - target.pos.x);
        awayY = Math.sign(attacker.pos.y - target.pos.y);
    }

    // Резервируем разные клетки для двух хиллеров
    const squadState =
        Memory.attackerSquads &&
        Memory.attackerSquads[attacker.memory.squadId];

    if (squadState) {
        if (squadState.healerTargetsTick !== Game.time) {
            squadState.healerTargetsTick = Game.time;
            squadState.healerTargets = {};
        }

        if (!squadState.healerTargets) {
            squadState.healerTargets = {};
        }
    }

    const candidates = [];

    for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
            if (dx === 0 && dy === 0) continue;

            const x = attacker.pos.x + dx;
            const y = attacker.pos.y + dy;

            // Не выбираем край комнаты для боевой позиции
            if (x < 1 || x > 48 || y < 1 || y > 48) {
                continue;
            }

            if (
                attacker.room.getTerrain().get(x, y) ===
                TERRAIN_MASK_WALL
            ) {
                continue;
            }

            const pos = new RoomPosition(
                x,
                y,
                attacker.room.name
            );

            const structures = pos.lookFor(LOOK_STRUCTURES);

            const blocked = structures.some(structure =>
                OBSTACLE_OBJECT_TYPES.includes(
                    structure.structureType
                )
            );

            if (blocked) continue;

            // Не занимаем клетку другого крипа
            const occupied = pos.lookFor(LOOK_CREEPS).some(other =>
                other.id !== creep.id &&
                other.id !== attacker.id
            );

            if (occupied) continue;

            // Не используем клетку, уже выбранную другим хиллером
            const reserved = squadState &&
                Object.entries(
                    squadState.healerTargets || {}
                ).some(([name, point]) =>
                    name !== creep.name &&
                    point.roomName === pos.roomName &&
                    point.x === pos.x &&
                    point.y === pos.y
                );

            if (reserved) continue;

            const moveDot = moveVector
                ? dx * moveVector.dx + dy * moveVector.dy
                : 0;

            const safeDot = dx * awayX + dy * awayY;

            candidates.push({
                pos,
                moveDot,
                safeDot,
                enemyRange:
                    target &&
                        target.pos.roomName === attacker.room.name
                        ? pos.getRangeTo(target)
                        : 0,
                distance: creep.pos.getRangeTo(pos)
            });
        }
    }

    if (candidates.length === 0) return;

    let preferred = candidates;

    if (moveVector) {
        // Не становимся впереди направления движения стрелка
        preferred = candidates.filter(candidate =>
            candidate.moveDot <= 0
        );

        // Если все такие клетки заняты, ждём освобождения пути
        if (preferred.length === 0) return;

        preferred.sort((a, b) =>
            a.moveDot - b.moveDot ||
            b.enemyRange - a.enemyRange ||
            a.distance - b.distance
        );
    } else {
        // Если стрелок стоит, выбираем безопасную сторону
        preferred.sort((a, b) =>
            b.safeDot - a.safeDot ||
            b.enemyRange - a.enemyRange ||
            a.distance - b.distance
        );
    }

    const destination = preferred[0].pos;

    if (squadState) {
        squadState.healerTargets[creep.name] = {
            x: destination.x,
            y: destination.y,
            roomName: destination.roomName
        };
    }

    if (!creep.pos.isEqualTo(destination)) {
        creep.moveTo(destination, {
            range: 0,
            reusePath: 3
        });
    }
}

// Выбираем позицию для отступления от Source Keeper
function getAwayFromSourceKeeperPosition(leader, state, steps = 2) {
    if (!leader) return null;

    // Сначала используем текущую цель отряда
    let keeper = state.targetId
        ? Game.getObjectById(state.targetId)
        : null;

    // Если текущая цель недоступна, ищем ближайшего
    // Source Keeper в комнате ведущего хиллера
    if (
        !keeper ||
        keeper.pos.roomName !== leader.pos.roomName ||
        !keeper.owner ||
        keeper.owner.username !== "Source Keeper"
    ) {
        const keepers = leader.room.find(FIND_HOSTILE_CREEPS, {
            filter: hostile =>
                hostile.owner &&
                hostile.owner.username === "Source Keeper"
        });

        keeper = leader.pos.findClosestByRange(keepers);
    }

    // Если хранитель не найден, короткое отступление невозможно
    if (!keeper) return null;

    // Определяем направление ОТ хранителя
    const dx = Math.sign(leader.pos.x - keeper.pos.x);
    const dy = Math.sign(leader.pos.y - keeper.pos.y);

    if (dx === 0 && dy === 0) return null;

    // Желаемая позиция на две клетки дальше от хранителя
    const desiredX = Math.max(
        1,
        Math.min(48, leader.pos.x + dx * steps)
    );

    const desiredY = Math.max(
        1,
        Math.min(48, leader.pos.y + dy * steps)
    );

    const candidates = [];
    const room = leader.room;
    const currentRange = leader.pos.getRangeTo(keeper);

    // Ищем запасные позиции рядом с желаемой точкой
    for (
        let x = Math.max(1, desiredX - 1);
        x <= Math.min(48, desiredX + 1);
        x++
    ) {
        for (
            let y = Math.max(1, desiredY - 1);
            y <= Math.min(48, desiredY + 1);
            y++
        ) {
            if (
                room.getTerrain().get(x, y) === TERRAIN_MASK_WALL
            ) {
                continue;
            }

            const pos = new RoomPosition(x, y, room.name);

            // Не выбираем непроходимые клетки
            const structures = pos.lookFor(LOOK_STRUCTURES);

            const blocked = structures.some(structure =>
                structure.structureType !== STRUCTURE_ROAD &&
                structure.structureType !== STRUCTURE_CONTAINER &&
                structure.structureType !== STRUCTURE_RAMPART &&
                OBSTACLE_OBJECT_TYPES.includes(
                    structure.structureType
                )
            );

            if (blocked) continue;

            // Не выбираем клетку, занятую другим крипом
            const occupied = pos.lookFor(LOOK_CREEPS).some(other =>
                other.id !== leader.id
            );

            if (occupied) continue;

            // Проверяем, что позиция действительно дальше от хранителя
            const enemyRange = pos.getRangeTo(keeper);

            if (enemyRange <= currentRange) continue;

            // Проверяем возможность добраться до позиции
            const path = leader.pos.findPathTo(pos, {
                range: 0,
                maxOps: 1000
            });

            if (path.length === 0) continue;

            // Оценка того, насколько позиция направлена
            // в сторону, противоположную хранителю
            const projection =
                (x - leader.pos.x) * dx +
                (y - leader.pos.y) * dy;

            candidates.push({
                x,
                y,
                roomName: room.name,
                enemyRange,
                projection,
                pathLength: path.length
            });
        }
    }

    // Предпочитаем позицию дальше от хранителя,
    // затем направление от него, затем короткий путь
    candidates.sort((a, b) =>
        (b.enemyRange - a.enemyRange) ||
        (b.projection - a.projection) ||
        (a.pathLength - b.pathLength)
    );

    if (candidates.length === 0) return null;

    const destination = candidates[0];

    return {
        x: destination.x,
        y: destination.y,
        roomName: destination.roomName
    };
}


// Проверяем, сражается ли отряд именно с Source Keeper
function isSourceKeeperEncounter(state, members, homeRoomName) {
    const target = state.targetId
        ? Game.getObjectById(state.targetId)
        : null;

    if (target) {
        return target.owner &&
            target.owner.username === "Source Keeper" &&
            target.pos.roomName !== homeRoomName;
    }

    // Запасная проверка, если цель ещё не записана
    const remoteMember = members.find(member =>
        !member.spawning &&
        member.pos.roomName !== homeRoomName
    );

    if (!remoteMember) return false;

    const hostiles = remoteMember.room.find(FIND_HOSTILE_CREEPS);

    return hostiles.length > 0 &&
        hostiles.every(hostile =>
            hostile.owner.username === "Source Keeper"
        );
}

// Получение общего состояния отряда
function getSquadState(squadId) {
    if (!Memory.attackerSquads) {
        Memory.attackerSquads = {};
    }

    if (!Memory.attackerSquads[squadId]) {
        Memory.attackerSquads[squadId] = {
            mode: "attack",
            targetId: null,
            keeperName: null,
            waitingForKeeper: false
        };
    }

    const state = Memory.attackerSquads[squadId];

    // Добавляем поля существующим отрядам,
    // созданным до обновления кода
    if (state.keeperName === undefined) {
        state.keeperName = null;
    }

    if (state.waitingForKeeper === undefined) {
        state.waitingForKeeper = false;
    }

    return state;
}

// Проверка здоровья и состояния отряда
function updateSquadState(creep, expectedCount, homeRoomName) {
    const squadId = creep.memory.squadId;
    const members = getSquadMembers(squadId);
    const state = getSquadState(squadId);

    // Проверяем изменение здоровья участников один раз за тик
    if (state.lastDamageCheckTick !== Game.time) {
        const previousHits = state.lastMemberHits || {};
        let damageDetected = false;
        const currentHits = {};

        for (const member of members) {
            if (member.spawning) continue;

            currentHits[member.id] = member.hits;

            if (
                Number.isFinite(previousHits[member.id]) &&
                member.hits < previousHits[member.id]
            ) {
                damageDetected = true;
            }
        }

        state.lastMemberHits = currentHits;
        state.lastDamageCheckTick = Game.time;
        state.damageDetectedTick = damageDetected
            ? Game.time
            : null;
    }

    const memberTookDamage =
        state.damageDetectedTick === Game.time;

    const attacker = members.find(member =>
        member.memory.role === "attacker" &&
        !member.spawning
    );

    const attackerNearEnd =
        attacker && attacker.ticksToLive <= 50;

    const injuredHealer = members.some(member =>
        !member.spawning &&
        member.memory.role === "attackerHealer" &&
        member.hits < member.hitsMax * 0.5
    );

    // Стрелка с остатком жизни <= 50 тиков
    // не учитываем при решении об отступлении по здоровью
    const lowHealthMember = members.some(member =>
        !member.spawning &&
        member.hits < member.hitsMax * 0.5 &&
        !(
            member.memory.role === "attacker" &&
            attackerNearEnd
        )
    );

    const tacticalModes = ["keeperRetreat", "keeperHeal"];

    // Если в коротком отступлении потеряли участника
    // или кто-то из нового состава ещё создаётся —
    // переходим к обычному отступлению домой
    if (
        tacticalModes.includes(state.mode) &&
        (
            members.length < expectedCount ||
            members.some(member => member.spawning)
        )
    ) {
        state.mode = "retreat";
        state.retreatRallyReached = false;
        state.targetId = null;
        delete state.retreatPosition;

        console.log(
            "[ОТРЯД] Состав изменился. Отступаем домой."
        );
    }

    // Последние 50 тиков жизни стрелка:
    // если хиллерам не требуется срочное восстановление,
    // возобновляем бой вместо отступления
    if (
        attackerNearEnd &&
        !injuredHealer &&
        ["retreat", "keeperRetreat", "keeperHeal"].includes(state.mode) &&
        members.length >= expectedCount &&
        members.every(member => !member.spawning)
    ) {
        state.mode = "attack";
        state.targetId = null;
        delete state.retreatPosition;

        console.log(
            "[ОТРЯД] Стрелку осталось не более 50 тиков. " +
            "Продолжаем бой."
        );
    }

    // При опасном ранении выбираем способ отступления
    if (state.mode === "attack" && lowHealthMember) {
        const leader = getRetreatLeader(members);

        const fullSquad =
            members.length >= expectedCount &&
            members.every(member => !member.spawning);

        const sameRoom = leader &&
            members.every(member =>
                member.pos.roomName === leader.pos.roomName
            );

        const sourceKeeperEncounter =
            isSourceKeeperEncounter(state, members, homeRoomName);

        const retreatPosition =
            sourceKeeperEncounter && leader && fullSquad && sameRoom
                ? getAwayFromSourceKeeperPosition(
                    leader,
                    state,
                    2
                )
                : null;

        if (retreatPosition) {
            state.mode = "keeperRetreat";
            state.retreatPosition = retreatPosition;

            console.log(
                "[ОТРЯД] Source Keeper: короткое отступление " +
                "на 2 клетки в сторону дома."
            );
        } else {
            // Для других противников или если короткий маршрут
            // построить не удалось — возвращаемся домой
            state.mode = "retreat";
            state.retreatRallyReached = false;
            state.targetId = null;
            delete state.retreatPosition;

            console.log(
                "[ОТРЯД] Отступление домой: здоровье участника ниже 50%."
            );
        }
    }

    const leader = getRetreatLeader(members);

    // При получении новых повреждений во время лечения
    // отступаем ещё на 2 клетки в сторону дома
    if (
        state.mode === "keeperHeal" &&
        memberTookDamage
    ) {
        const leader = getRetreatLeader(members);

        const retreatPosition = leader
            ? getAwayFromSourceKeeperPosition(
                leader,
                state,
                2
            )
            : null;

        if (leader && retreatPosition) {
            state.mode = "keeperRetreat";
            state.retreatPosition = retreatPosition;

            console.log(
                "[ОТРЯД] Во время лечения получены повреждения. " +
                "Отступаем ещё на 2 клетки."
            );
        } else {
            // Если короткий путь больше недоступен,
            // используем обычное отступление домой
            state.mode = "retreat";
            state.retreatRallyReached = false;
            state.targetId = null;
            delete state.retreatPosition;

            console.log(
                "[ОТРЯД] Не удалось выбрать точку повторного отступления. " +
                "Возвращаемся домой."
            );
        }
    }

    const groupedWithLeader = leader &&
        members.length >= expectedCount &&
        members.every(member =>
            !member.spawning &&
            member.pos.roomName === leader.pos.roomName &&
            leader.pos.getRangeTo(member) <= 2
        );

    // Короткое отступление завершено:
    // хиллер достиг точки, а отряд собрался рядом
    if (
        state.mode === "keeperRetreat" &&
        leader &&
        state.retreatPosition &&
        leader.pos.isEqualTo(
            new RoomPosition(
                state.retreatPosition.x,
                state.retreatPosition.y,
                state.retreatPosition.roomName
            )
        ) &&
        groupedWithLeader
    ) {
        state.mode = "keeperHeal";

        console.log(
            "[ОТРЯД] Заняли позицию. Останавливаемся на лечение."
        );
    }
    /// После короткого отступления проверяем,
    // что оба хиллера рядом со стрелком
    const healers = members.filter(member =>
        member.memory.role === "attackerHealer" &&
        !member.spawning
    );

    const healersAdjacentToAttacker =
        attacker &&
        healers.length === 2 &&
        healers.every(healer =>
            healer.pos.roomName === attacker.pos.roomName &&
            attacker.pos.getRangeTo(healer) <= 1
        );

    // Возобновляем атаку, когда все здоровы
    // и оба хиллера находятся рядом со стрелком
    if (
        state.mode === "keeperHeal" &&
        healersAdjacentToAttacker &&
        members.length >= expectedCount &&
        members.every(member =>
            !member.spawning &&
            member.hits >= member.hitsMax
        )
    ) {
        state.mode = "attack";
        state.targetId = null;
        delete state.retreatPosition;

        console.log(
            "[ОТРЯД] Отряд полностью восстановлен. " +
            "Возобновляем атаку."
        );
    }

    // Проверяем, что весь отряд вернулся домой,
    // находится внутри комнаты и полностью собран
    const allMembersHomeAndSafe =
        members.length >= expectedCount &&
        members.every(member =>
            !member.spawning &&
            member.pos.roomName === homeRoomName &&
            member.pos.x > 0 &&
            member.pos.x < 49 &&
            member.pos.y > 0 &&
            member.pos.y < 49
        );

    // ЭТАП 1 завершён: переходим к сбору возле стрелка
    if (
        state.mode === "retreat" &&
        allMembersHomeAndSafe
    ) {
        state.mode = "retreatGather";
        state.modeSinceTick = Game.time;
        state.targetId = null;

        console.log(
            "[ОТРЯД] Все вернулись домой. Собираемся возле стрелка."
        );
    }

    // Проверяем, собрались ли все участники рядом со стрелком
    const regroupedNearAttacker =
        attacker &&
        allMembersHomeAndSafe &&
        members.every(member =>
            member.pos.roomName === attacker.pos.roomName &&
            attacker.pos.getRangeTo(member) <= 1
        );

    // ЭТАП 2 завершён: начинаем восстановление
    if (
        state.mode === "retreatGather" &&
        state.modeSinceTick < Game.time &&
        regroupedNearAttacker
    ) {
        state.mode = "retreatHeal";
        state.modeSinceTick = Game.time;

        console.log(
            "[ОТРЯД] Сбор завершён. Начинаем восстановление."
        );
    }

    // ЭТАП 3 завершён: здоровье восстановлено, можно атаковать
    if (
        state.mode === "retreatHeal" &&
        state.modeSinceTick < Game.time &&
        regroupedNearAttacker &&
        members.every(member =>
            member.hits >= member.hitsMax
        )
    ) {
        state.mode = "attack";
        state.targetId = null;
        delete state.retreatPosition;

        console.log(
            "[ОТРЯД] Отряд полностью восстановлен. Возобновляем атаку."
        );
    }

    return state;
}

// Лечение наиболее повреждённого участника в пределах 3 клеток
function healSquadMember(creep, members) {
    if (creep.getActiveBodyparts(HEAL) === 0) return;

    const targets = members.filter(member =>
        !member.spawning &&
        member.hits < member.hitsMax &&
        member.pos.roomName === creep.room.name &&
        creep.pos.getRangeTo(member) <= 3
    );

    if (targets.length === 0) return;

    // Сначала лечим участника с наименьшим процентом здоровья
    targets.sort((a, b) =>
        a.hits / a.hitsMax - b.hits / b.hitsMax
    );

    const target = targets[0];
    const range = creep.pos.getRangeTo(target);

    if (range <= 1) {
        creep.heal(target);
    } else {
        creep.rangedHeal(target);
    }
}

// Точка маршрута на одну клетку за границей комнаты
function getRetreatRallyPosition(fromRoomName, homeRoomName) {
    const route = Game.map.findRoute(
        fromRoomName,
        homeRoomName
    );

    if (!Array.isArray(route) || route.length === 0) {
        return null;
    }

    const nextRoomName = route[0].room;
    const exit = route[0].exit;
    const terrain = Game.map.getRoomTerrain(nextRoomName);
    const visibleRoom = Game.rooms[nextRoomName];

    const candidates = [];

    // Выбираем ряд на одну клетку внутри следующей комнаты
    if (exit === FIND_EXIT_TOP || exit === FIND_EXIT_BOTTOM) {
        const y = exit === FIND_EXIT_TOP ? 48 : 1;

        for (let x = 1; x <= 48; x++) {
            candidates.push({ x, y });
        }
    } else if (
        exit === FIND_EXIT_LEFT ||
        exit === FIND_EXIT_RIGHT
    ) {
        const x = exit === FIND_EXIT_LEFT ? 48 : 1;

        for (let y = 1; y <= 48; y++) {
            candidates.push({ x, y });
        }
    } else {
        return null;
    }

    // Учитываем стены и, если комната видна, препятствующие постройки
    const available = candidates.filter(pos => {
        if (terrain.get(pos.x, pos.y) === TERRAIN_MASK_WALL) {
            return false;
        }

        if (visibleRoom) {
            const structures = visibleRoom.lookForAt(
                LOOK_STRUCTURES,
                pos.x,
                pos.y
            );

            if (structures.some(structure =>
                OBSTACLE_OBJECT_TYPES.includes(
                    structure.structureType
                )
            )) {
                return false;
            }
        }

        return true;
    });

    // Выбираем ближайшую к середине комнаты свободную клетку
    available.sort((a, b) =>
        (Math.abs(a.x - 25) + Math.abs(a.y - 25)) -
        (Math.abs(b.x - 25) + Math.abs(b.y - 25))
    );

    if (available.length === 0) return null;

    return {
        ...available[0],
        roomName: nextRoomName
    };
}

// Возвращение в домашнюю комнату без подхода к спавну
function returnToSpawn(creep, spawn) {
    if (!spawn) return;

    const homeRoomName = spawn.room.name;

    // Если ещё не дома — движемся вглубь домашней комнаты
    if (creep.pos.roomName !== homeRoomName) {
        creep.moveTo(
            new RoomPosition(25, 25, homeRoomName),
            {
                range: 23,
                reusePath: 5
            }
        );

        return;
    }

    // Дома не двигаемся, если уже отошли от границы
    const onBorder =
        creep.pos.x === 0 ||
        creep.pos.x === 49 ||
        creep.pos.y === 0 ||
        creep.pos.y === 49;

    if (onBorder) {
        creep.moveTo(
            new RoomPosition(25, 25, homeRoomName),
            {
                range: 23,
                reusePath: 5
            }
        );
    }
}

module.exports = {

    role: "attacker",
    desiredCount: 1,

    // Роль и количество хиллеров отряда
    healerRole: "attackerHealer",
    healerDesiredCount: 2,

    // Целевая комната.
    // Пустая стрoка отключает создание отряда.E26N55
    targetRoom: "",

    // Стрелок: 10 TOUGH, 8 MOVE, 5 RANGED_ATTACK
    // TOUGH и MOVE расположены перед атакующими частями,
    // чтобы дольше сохранять возможность стрелять.
    body: [
        TOUGH, TOUGH, TOUGH, TOUGH, TOUGH,
        TOUGH, TOUGH, TOUGH, TOUGH, TOUGH,

        MOVE, MOVE, MOVE, MOVE,
        MOVE, MOVE, MOVE, MOVE,

        RANGED_ATTACK, RANGED_ATTACK, RANGED_ATTACK,
        RANGED_ATTACK, RANGED_ATTACK
    ],

    // Каждый хиллер: 3 HEAL и 3 MOVE
    healerBody: [
        MOVE, HEAL,
        MOVE, HEAL,
        MOVE, HEAL
    ],

    // Создание атакующего отряда
    manageSpawning: function (spawn) {

        // Без целевой комнаты отряд не создаём
        if (!this.targetRoom) return;

        // Если спавн занят, ждём
        if (spawn.spawning) return;

        const creeps = Object.values(Game.creeps);

        // Общий идентификатор отряда
        const squadId = "attackerSquad_" + this.targetRoom;

        // Считаем юнитов именно этого отряда
        const countRole = role => creeps.filter(
            creep =>
                creep.memory.role === role &&
                creep.memory.squadId === squadId
        ).length;

        // Сначала создаём двух хиллеров
        const healerCount = countRole(this.healerRole);

        if (healerCount < this.healerDesiredCount) {

            const cost = this.healerBody.reduce(
                (total, part) => total + BODYPART_COST[part],
                0
            );

            if (spawn.room.energyAvailable < cost) return;

            const name = "AttackerHealer_" + Game.time;

            const result = spawn.spawnCreep(
                this.healerBody,
                name,
                {
                    memory: {
                        role: this.healerRole,
                        targetRoom: this.targetRoom,
                        homeRoomName: spawn.room.name,
                        squadId: squadId
                    }
                }
            );

            if (result === OK) {
                console.log(
                    "[ОТРЯД] Создан хиллер: " + name
                );
            }

            return;
        }

        // Только после создания двух хиллеров создаём стрелка
        const attackerCount = countRole(this.role);

        if (attackerCount >= this.desiredCount) return;

        const cost = this.body.reduce(
            (total, part) => total + BODYPART_COST[part],
            0
        );

        if (spawn.room.energyAvailable < cost) return;

        const name = "Attacker_" + Game.time;

        const result = spawn.spawnCreep(
            this.body,
            name,
            {
                memory: {
                    role: this.role,
                    targetRoom: this.targetRoom,
                    homeRoomName: spawn.room.name,
                    squadId: squadId
                }
            }
        );

        if (result === OK) {
            console.log(
                "[ОТРЯД] Создан стрелок: " + name +
                ", цель: " + this.targetRoom
            );
        }
    },

    // Поведение стрелка
    runAttacker: function (creep, spawn) {

        if (creep.spawning) return;

        if (!spawn) {
            spawn = Game.spawns["Spawn1"];
        }

        if (!spawn || !creep.memory.targetRoom) return;

        const targetRoom = creep.memory.targetRoom;
        const homeRoomName =
            creep.memory.homeRoomName || spawn.room.name;

        const squadId = creep.memory.squadId;
        const members = getSquadMembers(squadId);

        const expectedCount =
            this.desiredCount + this.healerDesiredCount;

        const state = updateSquadState(
            creep,
            expectedCount,
            homeRoomName
        );

        // Обычное отступление: стрелок следует за ведущим хиллером
        if (state.mode === "retreat") {
            const leader = getRetreatLeader(members);

            if (!leader) {
                returnToSpawn(creep, spawn);
            } else if (
                creep.pos.roomName !== leader.pos.roomName ||
                creep.pos.getRangeTo(leader) > 1
            ) {
                creep.moveTo(leader, {
                    range: 1,
                    reusePath: 3
                });
            }

            return;
        }

        // Дома стрелок ждёт, пока хиллеры соберутся
        // и полностью восстановят здоровье
        if (
            state.mode === "retreatGather" ||
            state.mode === "retreatHeal"
        ) {
            return;
        }

        // Короткое отступление и лечение:
        // стрелок держится рядом с ведущим хиллером
        // Во время короткого отступления следуем за ведущим хиллером
        if (state.mode === "keeperRetreat") {
            const leader = getRetreatLeader(members);

            if (!leader) {
                returnToSpawn(creep, spawn);
                return;
            }

            if (
                creep.pos.roomName !== leader.pos.roomName ||
                creep.pos.getRangeTo(leader) > 2
            ) {
                creep.moveTo(leader, {
                    range: 1,
                    reusePath: 3
                });
            }

            return;
        }

        // Во время лечения стрелок остаётся на месте,
        // чтобы хиллеры могли подойти к нему
        if (state.mode === "keeperHeal") {
            return;
        }

        // После пересечения границы атакующей комнаты
        // стрелок сначала делает шаг внутрь, не ожидая хиллеров
        if (
            creep.room.name === targetRoom &&
            (
                creep.pos.x === 0 ||
                creep.pos.x === 49 ||
                creep.pos.y === 0 ||
                creep.pos.y === 49
            )
        ) {
            // Координаты первой клетки внутри комнаты
            const x = Math.max(1, Math.min(48, creep.pos.x));
            const y = Math.max(1, Math.min(48, creep.pos.y));

            const innerPosition = new RoomPosition(
                x,
                y,
                targetRoom
            );

            creep.moveTo(innerPosition, {
                range: 0,
                reusePath: 0
            });

            return;
        }

        // Не отправляем отряд в бой, пока он не собран полностью
        if (
            members.length < expectedCount ||
            members.some(member => member.spawning)
        ) {
            returnToSpawn(creep, spawn);
            return;
        }

        // Не продвигаемся вперёд, если хиллеры отстали
        if (!areHealersCloseToAttacker(creep, members)) {
            return;
        }

        // Идём в целевую комнату
        if (creep.room.name !== targetRoom) {
            creep.moveTo(
                new RoomPosition(25, 25, targetRoom),
                {
                    reusePath: 25
                }
            );

            return;
        }

        // Ищем только Source Keeper в целевой комнате
        const hostiles = creep.room.find(FIND_HOSTILE_CREEPS, {
            filter: hostile =>
                hostile.owner &&
                hostile.owner.username === "Source Keeper"
        });

        const previousTargetId = state.targetId;
        let target = null;

        // При первом обнаружении запоминаем имя хранителя
        if (!state.keeperName) {
            target = creep.pos.findClosestByRange(hostiles);

            if (target) {
                state.keeperName = target.name;

                console.log(
                    "[ОТРЯД] Запомнили Source Keeper: " +
                    state.keeperName
                );
            }
        } else {
            // Ищем только хранителя с запомненным именем
            target = hostiles.find(
                hostile => hostile.name === state.keeperName
            ) || null;
        }

        // Если нужного хранителя сейчас нет — ждём
        if (!target) {
            if (previousTargetId) {
                state.waitingForKeeper = true;
            }

            state.targetId = null;

            if (Game.time % 25 === 0) {
                console.log(
                    "[ОТРЯД] Ожидаем появления Source Keeper: " +
                    (state.keeperName || "первый хранитель")
                );
            }

            return;
        }

        // Если появился новый объект с тем же именем,
        // ждём полного восстановления перед атакой
        if (
            previousTargetId &&
            previousTargetId !== target.id
        ) {
            state.waitingForKeeper = true;
        }

        state.targetId = target.id;

        // После гибели хранителя не начинаем следующий бой,
        // пока все три участника не будут полностью здоровы
        if (state.waitingForKeeper) {
            const fullyHealed =
                members.length >= expectedCount &&
                members.every(member =>
                    !member.spawning &&
                    member.hits >= member.hitsMax
                );

            if (!fullyHealed) {
                return;
            }

            state.waitingForKeeper = false;

            console.log(
                "[ОТРЯД] Отряд восстановлен. Возобновляем атаку: " +
                state.keeperName
            );
        }

        // Если Source Keeper подошёл слишком близко,
        // отступаем на 2 клетки в сторону дома
        const keeperDistance = creep.pos.getRangeTo(target);

        const attackerNearEnd =
            Number.isFinite(creep.ticksToLive) &&
            creep.ticksToLive <= 50;

        const injuredHealer = members.some(member =>
            !member.spawning &&
            member.memory.role === "attackerHealer" &&
            member.hits < member.hitsMax * 0.5
        );

        if (
            target.owner &&
            target.owner.username === "Source Keeper" &&
            keeperDistance <= 2 &&
            !(attackerNearEnd && !injuredHealer)
        ) {
            const leader = getRetreatLeader(members);

            const fullSquad =
                members.length >= expectedCount &&
                members.every(member => !member.spawning);

            const sameRoom = leader &&
                members.every(member =>
                    member.pos.roomName === leader.pos.roomName
                );

            const retreatPosition =
                leader && fullSquad && sameRoom
                    ? getAwayFromSourceKeeperPosition(
                        leader,
                        state,
                        2
                    )
                    : null;

            if (retreatPosition) {
                state.mode = "keeperRetreat";
                state.retreatPosition = retreatPosition;

                console.log(
                    "[ОТРЯД] Source Keeper приблизился на 2 клетки. " +
                    "Отступаем."
                );
            } else {
                state.mode = "retreat";
                state.retreatRallyReached = false;
                state.targetId = null;
                delete state.retreatPosition;

                console.log(
                    "[ОТРЯД] Нет безопасной точки короткого отхода. " +
                    "Возвращаемся домой."
                );
            }

            return;
        }

        // Держимся на дистанции дальней атаки
        if (creep.pos.getRangeTo(target) > 3) {
            creep.moveTo(target, {
                range: 3,
                reusePath: 3
            });

            return;
        }

        // Атакуем выбранную цель
        creep.rangedAttack(target);
    },

    // Поведение хиллера отряда
    runAttackerHealer: function (creep, spawn) {

        if (creep.spawning) return;

        if (!spawn) {
            spawn = Game.spawns["Spawn1"];
        }

        if (!spawn) return;

        const homeRoomName =
            creep.memory.homeRoomName || spawn.room.name;

        const squadId = creep.memory.squadId;
        const members = getSquadMembers(squadId);

        const expectedCount =
            this.desiredCount + this.healerDesiredCount;

        const state = updateSquadState(
            creep,
            expectedCount,
            homeRoomName
        );

        // Лечим самого повреждённого доступного участника
        healSquadMember(creep, members);
        // Во время восстановления оба хиллера
        // обязательно подходят вплотную к стрелку
        if (state.mode === "keeperHeal") {
            const attacker = members.find(member =>
                member.memory.role === this.role &&
                !member.spawning
            );

            if (!attacker) {
                returnToSpawn(creep, spawn);
                return;
            }

            moveHealerAdjacentToAttacker(
                creep,
                attacker,
                members
            );

            return;
        }
        // Обычное отступление:
        // ведущий хиллер ждёт стрелка, второй идёт за ведущим
        if (state.mode === "retreat") {
            const leader = getRetreatLeader(members);

            const attacker = members.find(member =>
                member.memory.role === this.role &&
                !member.spawning
            );

            if (!leader) {
                returnToSpawn(creep, spawn);
                return;
            }

            if (creep.name === leader.name) {
                // Если стрелок погиб, хиллеры возвращаются домой
                if (!attacker) {
                    returnToSpawn(creep, spawn);
                    return;
                }

                // Ведущий движется домой только тогда,
                // когда стрелок находится рядом
                if (
                    attacker.pos.roomName === creep.pos.roomName &&
                    creep.pos.getRangeTo(attacker) <= 2
                ) {
                    returnToSpawn(creep, spawn);
                }

                return;
            }

            // Второй хиллер следует за ведущим
            if (
                creep.pos.roomName !== leader.pos.roomName ||
                creep.pos.getRangeTo(leader) > 2
            ) {
                creep.moveTo(leader, {
                    range: 1,
                    reusePath: 3
                });
            }

            return;
        }

        // После возвращения домой хиллеры собираются возле стрелка
        if (
            state.mode === "retreatGather" ||
            state.mode === "retreatHeal"
        ) {
            const attacker = members.find(member =>
                member.memory.role === this.role &&
                !member.spawning
            );

            if (!attacker) {
                returnToSpawn(creep, spawn);
                return;
            }

            // Стремимся подойти вплотную к стрелку
            if (
                creep.pos.roomName !== attacker.pos.roomName ||
                creep.pos.getRangeTo(attacker) > 1
            ) {
                creep.moveTo(attacker, {
                    range: 1,
                    reusePath: 3
                });
            }

            return;
        }

        // Короткое отступление и лечение
        if (
            state.mode === "keeperRetreat" ||
            state.mode === "keeperHeal"
        ) {
            const leader = getRetreatLeader(members);

            const attacker = members.find(member =>
                member.memory.role === this.role &&
                !member.spawning
            );

            const target = state.targetId
                ? Game.getObjectById(state.targetId)
                : null;

            if (!attacker) {
                returnToSpawn(creep, spawn);
                return;
            }
            // Режим лечения после короткого отступления:
            // оба хиллера подходят вплотную к стрелку
            if (state.mode === "keeperHeal") {
                if (
                    creep.pos.roomName !== attacker.pos.roomName ||
                    creep.pos.getRangeTo(attacker) > 1
                ) {
                    creep.moveTo(attacker, {
                        range: 1,
                        reusePath: 3
                    });
                }

                return;
            }

            if (!leader) {
                moveHealerBehindAttacker(
                    creep,
                    attacker,
                    target,
                    members
                );
                return;
            }

            // При коротком отступлении ведущий хиллер
            // идёт к безопасной точке в сторону дома
            if (
                state.mode === "keeperRetreat" &&
                creep.name === leader.name
            ) {
                if (state.retreatPosition) {
                    const position = new RoomPosition(
                        state.retreatPosition.x,
                        state.retreatPosition.y,
                        state.retreatPosition.roomName
                    );

                    if (!creep.pos.isEqualTo(position)) {
                        creep.moveTo(position, {
                            range: 0,
                            reusePath: 3
                        });
                    }
                }

                return;
            }

            // Второй хиллер при отступлении и оба хиллера
            // при лечении занимают задние позиции у стрелка
            moveHealerBehindAttacker(
                creep,
                attacker,
                target,
                members
            );

            return;
        }

        // Пока отряд не собран, хиллер остаётся дома
        if (
            members.length < expectedCount ||
            members.some(member => member.spawning)
        ) {
            returnToSpawn(creep, spawn);
            return;
        }

        // Находим своего стрелка
        const attacker = members.find(
            member => member.memory.role === this.role
        );

        if (!attacker) {
            returnToSpawn(creep, spawn);
            return;
        }

        // Держимся за стрелком и выбираем заднюю позицию
        const stateTarget = state.targetId
            ? Game.getObjectById(state.targetId)
            : null;

        moveHealerBehindAttacker(
            creep,
            attacker,
            stateTarget,
            members
        );
    }

};