// Получение всех участников одного отряда
function getSquadMembers(squadId) {
    return Object.values(Game.creeps).filter(
        creep => creep.memory.squadId === squadId
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
            targetId: null
        };
    }

    return Memory.attackerSquads[squadId];
}

// Проверка здоровья и состояния отряда
function updateSquadState(creep, expectedCount, homeRoomName) {
    const squadId = creep.memory.squadId;
    const members = getSquadMembers(squadId);
    const state = getSquadState(squadId);

    // Если здоровье любого участника ниже 50%,
    // переводим весь отряд в режим отступления
    if (
        state.mode !== "retreat" &&
        members.some(member =>
            !member.spawning &&
            member.hits < member.hitsMax * 0.5
        )
    ) {
        state.mode = "retreat";
        state.targetId = null;

        console.log(
            "[ОТРЯД] Отступление: здоровье участника ниже 50%"
        );
    }

    // Возобновляем атаку только после возвращения
    // всех участников домой и полного восстановления
    if (
        state.mode === "retreat" &&
        members.length >= expectedCount &&
        members.every(member =>
            !member.spawning &&
            member.pos.roomName === homeRoomName &&
            member.hits >= member.hitsMax
        )
    ) {
        state.mode = "attack";
        state.targetId = null;

        console.log(
            "[ОТРЯД] Все участники восстановлены. Возобновляем атаку."
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

// Возвращение к домашнему спавну
function returnToSpawn(creep, spawn) {
    if (!spawn) return;

    if (
        creep.pos.roomName !== spawn.room.name ||
        creep.pos.getRangeTo(spawn) > 1
    ) {
        creep.moveTo(spawn, {
            range: 1,
            reusePath: 5
        });
    }
}

module.exports = {

    role: "attacker",
    desiredCount: 1,

    // Роль и количество хиллеров отряда
    healerRole: "attackerHealer",
    healerDesiredCount: 2,

    // Целевая комната.
    // Пустая строка отключает создание отряда.
    targetRoom: "E26N55",

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

        // Отступаем домой при критическом повреждении
        if (state.mode === "retreat") {
            returnToSpawn(creep, spawn);
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

        // Ищем врагов в целевой комнате
        const hostiles = creep.room.find(FIND_HOSTILE_CREEPS);

        // Сохраняем текущую цель, пока она существует
        let target = state.targetId
            ? Game.getObjectById(state.targetId)
            : null;

        // Если цели больше нет в этой комнате,
        // выбираем ближайшего к стрелку противника
        if (
            !target ||
            target.pos.roomName !== targetRoom ||
            !hostiles.some(hostile => hostile.id === target.id)
        ) {
            target = creep.pos.findClosestByRange(hostiles);
            state.targetId = target ? target.id : null;
        }

        // В комнате пока нет врагов
        if (!target) return;

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

        // При отступлении возвращаемся домой,
        // продолжая лечить союзников по пути
        if (state.mode === "retreat") {
            returnToSpawn(creep, spawn);
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

        // Движемся вместе со стрелком.
        // Во время марша держимся на расстоянии одной клетки.
        const stateTarget = state.targetId
            ? Game.getObjectById(state.targetId)
            : null;

        if (
            attacker.room.name !== creep.room.name ||
            !stateTarget ||
            stateTarget.pos.roomName !== attacker.room.name
        ) {
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

        // Определяем положение позади стрелка относительно цели
        const dx = Math.sign(attacker.pos.x - stateTarget.pos.x);
        const dy = Math.sign(attacker.pos.y - stateTarget.pos.y);

        const directions = [
            { x: 0, y: -1 },
            { x: 1, y: -1 },
            { x: 1, y: 0 },
            { x: 1, y: 1 },
            { x: 0, y: 1 },
            { x: -1, y: 1 },
            { x: -1, y: 0 },
            { x: -1, y: -1 }
        ];

        const directionIndex = directions.findIndex(
            direction =>
                direction.x === dx &&
                direction.y === dy
        );

        if (directionIndex < 0) {
            creep.moveTo(attacker, {
                range: 1,
                reusePath: 3
            });

            return;
        }

        // Два хиллера занимают разные клетки позади стрелка
        const healers = members
            .filter(member =>
                member.memory.role === this.healerRole
            )
            .sort((a, b) => a.name.localeCompare(b.name));

        const healerIndex = healers.findIndex(
            healer => healer.name === creep.name
        );

        const offsetIndex = (
            directionIndex + Math.max(0, healerIndex)
        ) % directions.length;

        const direction = directions[offsetIndex];

        const x = attacker.pos.x + direction.x;
        const y = attacker.pos.y + direction.y;

        // Если позиция выходит за границы комнаты,
        // держимся рядом со стрелком
        if (x < 0 || x > 49 || y < 0 || y > 49) {
            creep.moveTo(attacker, {
                range: 1,
                reusePath: 3
            });

            return;
        }

        const position = new RoomPosition(
            x,
            y,
            attacker.room.name
        );

        if (!creep.pos.isEqualTo(position)) {
            creep.moveTo(position, {
                range: 0,
                reusePath: 3
            });
        }
    }

};