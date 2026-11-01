module.exports = {
    role: "attacker",
    desiredCount: 1,

    healerRole: "attackerHealer",
    healerDesiredCount: 2,

    targetRoom: "E26N55",
    previewOnly: false,

    body: [
        TOUGH, TOUGH, TOUGH, TOUGH, TOUGH,
        TOUGH, TOUGH, TOUGH, TOUGH, TOUGH,

        MOVE, MOVE, MOVE, MOVE,
        MOVE, MOVE, MOVE, MOVE,

        RANGED_ATTACK, RANGED_ATTACK, RANGED_ATTACK,
        RANGED_ATTACK, RANGED_ATTACK
    ],

    advancedBody: [
        TOUGH, TOUGH, TOUGH, TOUGH, TOUGH,
        TOUGH, TOUGH, TOUGH, TOUGH, TOUGH,

        MOVE, MOVE, MOVE, MOVE, MOVE,
        MOVE, MOVE, MOVE, MOVE, MOVE,

        RANGED_ATTACK, RANGED_ATTACK, RANGED_ATTACK,
        RANGED_ATTACK, RANGED_ATTACK, RANGED_ATTACK,
        RANGED_ATTACK, RANGED_ATTACK
    ],

    healerBody: [
        MOVE, HEAL,
        MOVE, HEAL,
        MOVE, HEAL,
        MOVE, HEAL
    ],

    getAttackerBody(spawn) {
        const extensions = spawn.room.find(FIND_MY_STRUCTURES, {
            filter: structure =>
                structure.structureType === STRUCTURE_EXTENSION
        }).length;

        if (extensions >= 30) return this.advancedBody;
        if (extensions >= 20) return this.body;

        return null;
    },

    calculatePositions(creep, keeper) {
        const lair = Game.getObjectById(creep.memory.keeperLairId);

        if (!lair) return [];

        const candidates = [];

        // Перебираем все клетки на расстоянии 3 от Keeper.
        for (let x = keeper.pos.x - 3; x <= keeper.pos.x + 3; x++) {
            for (let y = keeper.pos.y - 3; y <= keeper.pos.y + 3; y++) {

                if (x < 0 || x > 49 || y < 0 || y > 49) continue;

                const pos = new RoomPosition(x, y, keeper.room.name);

                if (keeper.pos.getRangeTo(pos) !== 3) continue;

                candidates.push(pos);
            }
        }

        const results = [];

        // Оцениваем все найденные клетки-кандидаты.
        for (const pos of candidates) {

            const terrain = Game.map.getRoomTerrain(pos.roomName);

            // Кандидат на стене исключается.
            if (terrain.get(pos.x, pos.y) === TERRAIN_MASK_WALL) continue;

            const structures = pos.lookFor(LOOK_STRUCTURES);

            // Исключаем непроходимые сооружения.
            const blocked = structures.some(structure =>
                structure.structureType !== STRUCTURE_ROAD &&
                structure.structureType !== STRUCTURE_CONTAINER &&
                structure.structureType !== STRUCTURE_RAMPART
            );

            if (blocked) continue;

            let score = 5;

            // Штраф за близость к Keeper Lair.
            const lairDistance = pos.getRangeTo(lair.pos);

            const lairPenalty = {
                1: 10,
                2: 8,
                3: 6,
                4: 4,
                5: 2
            };

            score -= lairPenalty[lairDistance] || 0;

            // Штрафуем кандидата, если он находится на болоте.
            if (terrain.get(pos.x, pos.y) === TERRAIN_MASK_SWAMP) {
                score -= 2;
            }

            // Проверяем все восемь соседних клеток вокруг кандидата.
            for (let x = pos.x - 1; x <= pos.x + 1; x++) {
                for (let y = pos.y - 1; y <= pos.y + 1; y++) {

                    // Саму клетку-кандидата не проверяем.
                    if (x === pos.x && y === pos.y) continue;

                    // Проверяем расстояние до границ комнаты.
                    if (x < 0 || x > 49 || y < 0 || y > 49) {
                        score -= 2;
                        continue;
                    }

                    // Не учитываем клетки ближе 4 клеток к Keeper.
                    const keeperDistance = Math.max(
                        Math.abs(x - keeper.pos.x),
                        Math.abs(y - keeper.pos.y)
                    );

                    if (keeperDistance < 4) continue;

                    const tileTerrain = terrain.get(x, y);

                    if (tileTerrain === TERRAIN_MASK_WALL) {
                        score -= 2;
                        continue;
                    }

                    if (tileTerrain === TERRAIN_MASK_SWAMP) {
                        score += 0.5;
                    } else {
                        score += 2;
                    }
                }
            }

            // Учитываем других крипов на позиции кандидата.
            const creeps = pos.lookFor(LOOK_CREEPS);

            if (creeps.some(other => other.id !== creep.id)) {
                score -= 5;
            }

            results.push({
                x: pos.x,
                y: pos.y,
                score: score
            });
        }

        results.sort((a, b) => b.score - a.score);

        return results;
    },

    calculateRetreatPosition(creep, keeper) {
        const candidates = [];

        // Проверяем восемь соседних клеток вокруг атакера.
        for (let x = creep.pos.x - 1; x <= creep.pos.x + 1; x++) {
            for (let y = creep.pos.y - 1; y <= creep.pos.y + 1; y++) {

                // Саму текущую клетку не проверяем.
                if (x === creep.pos.x && y === creep.pos.y) continue;

                // Проверяем границы комнаты.
                if (x < 0 || x > 49 || y < 0 || y > 49) continue;

                const pos = new RoomPosition(x, y, creep.room.name);
                const terrain = Game.map.getRoomTerrain(pos.roomName);

                // Исключаем стены.
                if (terrain.get(x, y) === TERRAIN_MASK_WALL) continue;

                // Исключаем непроходимые сооружения.
                const structures = pos.lookFor(LOOK_STRUCTURES);

                const blocked = structures.some(structure =>
                    structure.structureType !== STRUCTURE_ROAD &&
                    structure.structureType !== STRUCTURE_CONTAINER &&
                    structure.structureType !== STRUCTURE_RAMPART
                );

                if (blocked) continue;

                // Проверяем других крипов на позиции.
                const creeps = pos.lookFor(LOOK_CREEPS);

                const occupiedByOther = creeps.some(other =>
                    other.id !== creep.id
                );

                const occupiedByHealer = creeps.some(other =>
                    other.id !== creep.id &&
                    other.memory.role === "attackerHealer"
                );

                // Исключаем занятые клетки, кроме клеток с хиллерами.
                if (occupiedByOther && !occupiedByHealer) continue;

                // Оценка расстояния до Keeper.
                let score = Math.min(pos.getRangeTo(keeper.pos), 6);

                // Штраф за болото.
                if (terrain.get(x, y) === TERRAIN_MASK_SWAMP) {
                    score -= 2;
                }

                // Штраф за ранее неудачную попытку отхода.
                const failedPositions = creep.memory.failedRetreatPositions || [];

                if (failedPositions.some(p => p.x === x && p.y === y)) {
                    score -= 5;
                }

                candidates.push({
                    x: x,
                    y: y,
                    score: score
                });
            }
        }

        // Сортируем от лучшей позиции к худшей.
        candidates.sort((a, b) => b.score - a.score);

        return candidates;
    },

    calculateHealerPositions(healer, attacker, keeper) {
        const firePosition = attacker.memory.firePosition;

        if (!firePosition) return [];

        const candidates = [];

        // Перебираем восемь клеток вокруг огневой позиции атакера.
        for (let x = firePosition.x - 1; x <= firePosition.x + 1; x++) {
            for (let y = firePosition.y - 1; y <= firePosition.y + 1; y++) {

                // Исключаем саму огневую позицию.
                if (x === firePosition.x && y === firePosition.y) continue;

                // Проверяем границы комнаты.
                if (x < 0 || x > 49 || y < 0 || y > 49) continue;

                const pos = new RoomPosition(x, y, attacker.room.name);
                const terrain = Game.map.getRoomTerrain(pos.roomName);

                // Исключаем стены.
                if (terrain.get(x, y) === TERRAIN_MASK_WALL) continue;

                // Исключаем непроходимые сооружения.
                const structures = pos.lookFor(LOOK_STRUCTURES);

                const blocked = structures.some(structure =>
                    structure.structureType !== STRUCTURE_ROAD &&
                    structure.structureType !== STRUCTURE_CONTAINER &&
                    structure.structureType !== STRUCTURE_RAMPART
                );

                if (blocked) continue;

                // Исключаем клетки, зарезервированные другими хиллерами.
                const reserved = Object.values(Game.creeps).some(other =>
                    other.id !== healer.id &&
                    other.memory.role === "attackerHealer" &&
                    other.memory.healerPosition &&
                    other.memory.healerPosition.x === x &&
                    other.memory.healerPosition.y === y
                );

                if (reserved) continue;

                // Проверяем расстояние до Keeper.
                const keeperDistance = pos.getRangeTo(keeper.pos);

                // Исключаем позиции на расстоянии 3 и меньше.
                if (keeperDistance <= 3) continue;

                // Чем дальше от Keeper, тем выше оценка.
                let score = keeperDistance;

                // Штраф за болото.
                if (terrain.get(x, y) === TERRAIN_MASK_SWAMP) {
                    score -= 2;
                }

                // Штраф за клетку, на которой хиллер ранее получил урон.
                const damagedPosition = healer.memory.damagedPosition;

                if (
                    damagedPosition &&
                    damagedPosition.x === x &&
                    damagedPosition.y === y
                ) {
                    score -= 1;
                }

                candidates.push({
                    x: x,
                    y: y,
                    score: score
                });
            }
        }

        candidates.sort((a, b) => b.score - a.score);

        return candidates;
    },

    healAttackerGroup(creep, attacker) {
        // Собираем группу для лечения.
        const targets = Object.values(Game.creeps).filter(other =>
            other.id === attacker.id ||
            other.memory.role === "attackerHealer"
        );

        // Оставляем повреждённых крипов в радиусе лечения.
        const injured = targets.filter(target =>
            target.hits < target.hitsMax &&
            creep.pos.getRangeTo(target) <= 3
        );

        if (injured.length === 0) return;

        // Выбираем наиболее повреждённого по проценту здоровья.
        injured.sort((a, b) =>
            a.hits / a.hitsMax - b.hits / b.hitsMax
        );

        const target = injured[0];

        // Лечим на соседней клетке.
        if (creep.pos.getRangeTo(target) <= 1) {
            creep.heal(target);
        } else {
            // Лечим на расстоянии.
            creep.rangedHeal(target);
        }
    },


    runInvaderMode(creep) {
        // Ищем Invader в комнате.
        const invader = creep.room.find(FIND_HOSTILE_CREEPS, {
            filter: hostile => hostile.owner.username === "Invader"
        }).sort((a, b) =>
            creep.pos.getRangeTo(a) - creep.pos.getRangeTo(b)
        )[0];

        // Если Invader обнаружен.
        if (invader) {

            if (!creep.memory.invaderMode) {
                creep.memory.invaderMode = true;
                creep.memory.invaderRetreated = false;

                console.log(
                    "[ATTACKER] Обнаружен Invader: " + invader.name
                );
            }

            // Однократное отступление с огневой позиции.
            if (!creep.memory.invaderRetreated) {
                const firePosition = creep.memory.firePosition;

                if (
                    firePosition &&
                    creep.pos.x === firePosition.x &&
                    creep.pos.y === firePosition.y
                ) {
                    if (!creep.memory.invaderRetreatPosition) {
                        const positions = this.calculateRetreatPosition(
                            creep,
                            invader
                        );

                        if (positions.length > 0) {
                            creep.memory.invaderRetreatPosition = {
                                x: positions[0].x,
                                y: positions[0].y
                            };
                        }
                    }

                    const retreatPosition =
                        creep.memory.invaderRetreatPosition;

                    if (retreatPosition) {
                        const targetPos = new RoomPosition(
                            retreatPosition.x,
                            retreatPosition.y,
                            creep.room.name
                        );

                        if (!creep.pos.isEqualTo(targetPos)) {
                            creep.move(
                                creep.pos.getDirectionTo(targetPos)
                            );
                            return true;
                        }
                    }
                }

                creep.memory.invaderRetreated = true;

                console.log(
                    "[ATTACKER] Отступление завершено."
                );
            }

            // Атакуем, если Invader находится в радиусе стрельбы.
            if (creep.pos.getRangeTo(invader) <= 3) {
                creep.rangedAttack(invader);
            }

            return true;
        }

        // Если Invader исчез, завершаем режим.
        if (creep.memory.invaderMode) {
            delete creep.memory.invaderMode;
            delete creep.memory.invaderRetreated;
            delete creep.memory.invaderRetreatPosition;

            console.log(
                "[ATTACKER] Invader исчез. Возвращаемся к Keeper."
            );
        }

        return false;
    },


    manageSpawning(spawn) {
        if (!spawn || spawn.spawning) return;

        if (!this.targetRoom) return;

        const attackers = Object.values(Game.creeps).filter(
            creep => creep.memory.role === this.role
        ).length;

        // Сначала создаём атакера.
        if (attackers < this.desiredCount) {
            const body = this.getAttackerBody(spawn);
            if (!body) return;

            const cost = body.reduce(
                (total, part) => total + BODYPART_COST[part],
                0
            );

            if (spawn.room.energyAvailable < cost) return;

            const name = this.role + "_" + Game.time;

            const result = spawn.spawnCreep(body, name, {
                memory: {
                    role: this.role
                }
            });

            if (result === OK) {
                console.log("[ATTACKER] Создаётся " + name);
            }

            return;
        }

        // Затем создаём хиллеров.
        const healers = Object.values(Game.creeps).filter(
            creep => creep.memory.role === this.healerRole
        ).length;

        if (healers >= this.healerDesiredCount) return;

        const healerCost = this.healerBody.reduce(
            (total, part) => total + BODYPART_COST[part],
            0
        );

        if (spawn.room.energyAvailable < healerCost) return;

        const name = this.healerRole + "_" + Game.time;

        const result = spawn.spawnCreep(this.healerBody, name, {
            memory: {
                role: this.healerRole
            }
        });

        if (result === OK) {
            console.log("[ATTACKER] Создаётся хиллер " + name);
        }
    },

    runAttacker(creep) {
        if (creep.spawning) return;
        if (!this.targetRoom) return;

        // Переход в целевую комнату.
        if (creep.room.name !== this.targetRoom) {
            const exit = creep.pos.findClosestByRange(
                creep.room.findExitTo(this.targetRoom)
            );

            if (exit) {
                creep.moveTo(exit, { reusePath: 20 });
            }

            return;
        }

        // Проверяем режим борьбы с Invader.
        if (this.runInvaderMode(creep)) return;

        // 2. Поиск ближайшего Keeper Lair.
        if (!creep.memory.keeperLairId) {
            const lairs = creep.room.find(FIND_STRUCTURES, {
                filter: structure =>
                    structure.structureType === STRUCTURE_KEEPER_LAIR
            });

            const nearestLair = creep.pos.findClosestByRange(lairs);

            if (!nearestLair) return;

            creep.memory.keeperLairId = nearestLair.id;

            console.log(
                "[ATTACKER] Найден Keeper Lair: " + nearestLair.id
            );
        }

        // 3. Формирование имени Keeper.
        const keeperName = "Keeper" + creep.memory.keeperLairId;

        // 4. Поиск соответствующего Keeper.
        const keeper = creep.room.find(FIND_HOSTILE_CREEPS, {
            filter: c => c.name === keeperName
        })[0];

        if (!keeper) {
            if (creep.memory.keeperName) {
                delete creep.memory.keeperName;
            }

            return;
        }

        // Проверяем здоровье всей группы.
        const group = [
            creep,
            ...Object.values(Game.creeps).filter(c =>
                c.memory.role === "attackerHealer" &&
                !c.spawning
            )
        ];

        // Включаем отступление, если кто-либо из группы потерял более 50% здоровья.
        if (group.some(member => member.hits < member.hitsMax * 0.5)) {
            if (!creep.memory.retreatMode) {
                creep.memory.retreatMode = true;

                console.log(
                    "[ATTACKER] Участник группы получил критический урон. Начинаем отступление."
                );
            }
        }

        // Проверяем здоровье всей группы.
        if (creep.memory.retreatMode) {

            const group = [
                creep,
                ...Object.values(Game.creeps).filter(c =>
                    c.memory.role === "attackerHealer" &&
                    !c.spawning
                )
            ];

            // Снимаем режим только после полного восстановления всей группы.
            const fullyHealed = group.every(member =>
                member.hits === member.hitsMax
            );

            if (fullyHealed) {
                delete creep.memory.retreatMode;
                delete creep.memory.retreatLastHits;
                delete creep.memory.pendingRetreatPosition;

                console.log("[ATTACKER] Вся группа восстановила здоровье. Отступление завершено.");
            }
        }

        // Проверяем результат предыдущей попытки отхода.
        if (creep.memory.pendingRetreatPosition) {
            const target = creep.memory.pendingRetreatPosition;

            // Если достигли цели — завершаем попытку.
            if (creep.pos.x === target.x && creep.pos.y === target.y) {
                delete creep.memory.pendingRetreatPosition;
            } else {

                // Пока есть усталость, не считаем попытку неудачной.
                if (creep.fatigue > 0) return;

                // Проверяем, изменилось ли положение стрелка.
                if (
                    creep.pos.x === target.lastX &&
                    creep.pos.y === target.lastY
                ) {
                    target.stuckTicks = (target.stuckTicks || 0) + 1;
                } else {
                    target.lastX = creep.pos.x;
                    target.lastY = creep.pos.y;
                    target.stuckTicks = 0;
                }

                // Если три тика нет прогресса — считаем клетку недоступной.
                if (target.stuckTicks >= 3) {
                    if (!creep.memory.failedRetreatPositions) {
                        creep.memory.failedRetreatPositions = [];
                    }

                    creep.memory.failedRetreatPositions.push({
                        x: target.x,
                        y: target.y
                    });

                    delete creep.memory.pendingRetreatPosition;
                    delete creep.memory.retreatLastHits;

                } else {
                    // Продолжаем движение к прежней цели.
                    const targetPos = new RoomPosition(
                        target.x,
                        target.y,
                        creep.room.name
                    );

                    creep.move(creep.pos.getDirectionTo(targetPos));
                    return;
                }
            }
        }

        // 5. Сохраняем имя найденного Keeper.
        if (creep.memory.keeperName !== keeper.name) {
            creep.memory.keeperName = keeper.name;

            console.log(
                "[ATTACKER] Найден Keeper: " + keeper.name
            );
        }

        // Режим отхода при здоровье ниже 50%.
        if (creep.memory.retreatMode) {

            // Если предыдущая попытка ещё выполняется,
            // её обработка происходит выше.
            if (creep.memory.pendingRetreatPosition) return;

            const lastHits = creep.memory.retreatLastHits;

            // Если здоровье не уменьшилось — новую позицию пока не выбираем.
            if (lastHits !== undefined && creep.hits >= lastHits) {
                return;
            }

            const positions = this.calculateRetreatPosition(creep, keeper);

            if (positions.length > 0) {
                const target = positions[0];

                creep.memory.pendingRetreatPosition = {
                    x: target.x,
                    y: target.y,
                    lastX: creep.pos.x,
                    lastY: creep.pos.y,
                    stuckTicks: 0
                };

                const targetPos = new RoomPosition(
                    target.x,
                    target.y,
                    creep.room.name
                );

                creep.move(creep.pos.getDirectionTo(targetPos));

                // Запоминаем здоровье на момент новой попытки отхода.
                creep.memory.retreatLastHits = creep.hits;
            }

            return;
        }

        // 6. Отслеживание неподвижности Keeper.
        const keeperPosition = keeper.pos.x + ":" + keeper.pos.y;

        // Если огневые позиции уже рассчитаны.
        if (creep.memory.positionsCalculated) {

            const currentKeeperPosition =
                keeper.pos.x + ":" + keeper.pos.y;

            // Если Keeper переместился — запускаем новый цикл расчёта.
            if (currentKeeperPosition !== creep.memory.calculatedKeeperPosition) {

                creep.memory.positionsCalculated = false;
                creep.memory.keeperStillTicks = 0;
                creep.memory.lastKeeperPosition = currentKeeperPosition;

                delete creep.memory.firePosition;
                delete creep.memory.calculatedKeeperPosition;

                return;
            }

            // Если Keeper остался на месте — возвращаемся на огневую позицию.
            const firePosition = creep.memory.firePosition;

            if (firePosition) {
                const targetPos = new RoomPosition(
                    firePosition.x,
                    firePosition.y,
                    creep.room.name
                );

                if (!creep.pos.isEqualTo(targetPos)) {
                    creep.moveTo(targetPos, { reusePath: 20 });
                } else {
                    creep.rangedAttack(keeper);
                }
            }

            return;
        }

        if (creep.memory.lastKeeperPosition !== keeperPosition) {
            creep.memory.lastKeeperPosition = keeperPosition;
            creep.memory.keeperStillTicks = 0;
            return;
        }

        creep.memory.keeperStillTicks =
            (creep.memory.keeperStillTicks || 0) + 1;

        // Ждём 10 неподвижных тиков.
        if (creep.memory.keeperStillTicks < 10) return;

        // Отмечаем выполнение расчёта.
        creep.memory.positionsCalculated = true;

        // Рассчитываем огневые позиции.
        const positions = this.calculatePositions(creep, keeper);

        // Сохраняем положение Keeper на момент расчёта.
        creep.memory.calculatedKeeperPosition =
            keeper.pos.x + ":" + keeper.pos.y;

        // Сохраняем лучшую огневую позицию.
        if (positions.length > 0) {
            creep.memory.firePosition = {
                x: positions[0].x,
                y: positions[0].y
            };
        }

        console.log(
            "[ATTACKER] Рассчитано кандидатов: " + positions.length
        );

        for (const position of positions) {
            console.log(
                "[ATTACKER] Позиция " +
                position.x + "," + position.y +
                " — оценка: " + position.score
            );
        }
    },

    runAttackerHealer(creep) {
        if (creep.spawning) return;
        // Отслеживаем получение урона.
        if (creep.memory.lastHits !== undefined) {
            if (creep.hits < creep.memory.lastHits) {
                creep.memory.damagedPosition = {
                    x: creep.pos.x,
                    y: creep.pos.y
                };

                console.log(
                    "[ATTACKER HEALER] " + creep.name +
                    " получил урон на клетке " +
                    creep.pos.x + "," + creep.pos.y
                );
            }
        }

        // Сохраняем здоровье для следующей проверки.
        creep.memory.lastHits = creep.hits;
        if (!this.targetRoom) return;

        // 1. Находим атакера.
        const attacker = Object.values(Game.creeps).find(c =>
            c.memory.role === "attacker"
        );

        if (!attacker) return;

        // Переход в комнату атакера.
        if (creep.room.name !== attacker.room.name) {
            creep.moveTo(attacker, { reusePath: 20 });
            return;
        }

        // 2. Проверяем, рассчитана ли огневая позиция атакера.
        if (!attacker.memory.firePosition) return;

        // 3. Находим соответствующего Keeper.
        const keeperName = "Keeper" + attacker.memory.keeperLairId;

        const keeper = creep.room.find(FIND_HOSTILE_CREEPS, {
            filter: c => c.name === keeperName
        })[0];

        if (!keeper) return;

        // 5. Отступление вслед за атакером.
        if (attacker.memory.retreatMode) {

            // Получаем запланированную позицию атакера.
            // Если он уже достиг её, ориентируемся на его текущую позицию.
            const retreatTarget =
                attacker.memory.pendingRetreatPosition || attacker.pos;

            // Если позиция ещё не выбрана, рассчитываем её.
            if (!creep.memory.retreatPosition) {

                const positions = this.calculateRetreatPosition(creep, keeper);

                // Исключаем позиции, выбранные другими хиллерами.
                const availablePositions = positions.filter(position => {
                    return !Object.values(Game.creeps).some(other =>
                        other.id !== creep.id &&
                        other.memory.role === "attackerHealer" &&
                        other.memory.retreatPosition &&
                        other.memory.retreatPosition.x === position.x &&
                        other.memory.retreatPosition.y === position.y
                    );
                });

                // Выбираем позицию ближе к цели отступления атакера.
                availablePositions.sort((a, b) => {
                    const distanceA = Math.max(
                        Math.abs(a.x - retreatTarget.x),
                        Math.abs(a.y - retreatTarget.y)
                    );

                    const distanceB = Math.max(
                        Math.abs(b.x - retreatTarget.x),
                        Math.abs(b.y - retreatTarget.y)
                    );

                    return distanceA - distanceB || b.score - a.score;
                });

                if (availablePositions.length > 0) {
                    const target = availablePositions[0];

                    creep.memory.retreatPosition = {
                        x: target.x,
                        y: target.y
                    };
                }
            }

            // Движение к выбранной позиции.
            const retreatPosition = creep.memory.retreatPosition;

            if (retreatPosition) {
                const targetPos = new RoomPosition(
                    retreatPosition.x,
                    retreatPosition.y,
                    creep.room.name
                );

                if (!creep.pos.isEqualTo(targetPos)) {
                    creep.moveTo(targetPos, { reusePath: 20 });
                }
            }

            // Лечим группу во время отступления.
            this.healAttackerGroup(creep, attacker);

            return;
        }

        // Отступление завершено — освобождаем прежнюю позицию.
        delete creep.memory.retreatPosition;

        // Проверяем, не изменилась ли огневая позиция стрелка.
        const firePosition = attacker.memory.firePosition;
        const previousFirePosition = creep.memory.healerFirePosition;

        if (
            !previousFirePosition ||
            previousFirePosition.x !== firePosition.x ||
            previousFirePosition.y !== firePosition.y
        ) {
            // Сбрасываем старую позицию хиллера.
            delete creep.memory.healerPosition;

            // Запоминаем новую огневую позицию стрелка.
            creep.memory.healerFirePosition = {
                x: firePosition.x,
                y: firePosition.y
            };
        }

        // 4. Рассчитываем и сохраняем позицию хиллера.
        if (!creep.memory.healerPosition) {

            const positions = this.calculateHealerPositions(
                creep,
                attacker,
                keeper
            );

            if (positions.length === 0) return;

            const position = positions[0];

            creep.memory.healerPosition = {
                x: position.x,
                y: position.y
            };

            console.log(
                "[ATTACKER HEALER] " + creep.name +
                " выбрал позицию " +
                position.x + "," + position.y
            );
        }

        // 5. Движение к сохранённой позиции.
        const healerPosition = creep.memory.healerPosition;

        const targetPos = new RoomPosition(
            healerPosition.x,
            healerPosition.y,
            creep.room.name
        );

        if (!creep.pos.isEqualTo(targetPos)) {
            creep.moveTo(targetPos, { reusePath: 20 });
        } else {
            creep.rangedAttack(keeper);
        }

        // 6. Лечение группы.
        this.healAttackerGroup(creep, attacker);

    },

};
