// Тела для шахтёров

const MINER_BODY_Version_0 = [
    WORK, WORK,
    MOVE, MOVE
]; // 300 энергии

const MINER_BODY_Version_1 = [
    WORK, WORK, WORK,
    MOVE
]; // 350 энергии

const MINER_BODY_Version_4 = [
    WORK, WORK, WORK, WORK,
    MOVE, MOVE
]; // 500 энергии

const MINER_BODY_Version_6 = [
    WORK, WORK, WORK, WORK, WORK,
    MOVE, MOVE
]; // 600 энергии

const MINER_BODY_Version_10 = [
    WORK, WORK, WORK, WORK, WORK, WORK, WORK,
    MOVE, MOVE
]; // 800 энергии

// Выбор тела шахтёра по количеству построенных расширителей
function getBody(room) {
    const extensions = room.find(FIND_MY_STRUCTURES, {
        filter: structure =>
            structure.structureType === STRUCTURE_EXTENSION
    });

    if (extensions.length >= 10) {
        return MINER_BODY_Version_10;
    } else if (extensions.length >= 6) {
        return MINER_BODY_Version_6;
    } else if (extensions.length >= 4) {
        return MINER_BODY_Version_4;
    } else if (extensions.length >= 1) {
        return MINER_BODY_Version_1;
    }

    return MINER_BODY_Version_0;
}

// Создание шахтёров для отдельных источников энергии
function manageSpawning(spawn, calculateAllMineNeeds) {

    const room = spawn.room;
    const creeps = Object.values(Game.creeps);

    // Получаем список шахт и определяем, где нужны шахтёры
    const allMines = calculateAllMineNeeds(room);

    const eligibleMines = allMines.filter(
        mine => mine.desiredMiners > 0 && mine.level >= 2
    );

    // Выбираем тело по количеству построенных расширителей
    const body = getBody(room);

    const cost = body.reduce(
        (total, part) => total + BODYPART_COST[part],
        0
    );

    // Проверяем шахты по очереди
    const assignedMiners = creeps.filter(
        creep => creep.memory.role === "miner"
    );

    for (const mine of eligibleMines) {

        const minersOnMine = assignedMiners.filter(creep =>
            creep.memory.mineId === mine.id &&
            (creep.memory.mineRoomName || creep.memory.targetRoom) ===
            mine.roomName
        );

        // Не создаём третьего шахтёра сверх установленного запаса
        if (minersOnMine.length > mine.desiredMiners + 1) continue;

        // Проверяем, заканчивается ли жизнь действующего шахтёра
        const minerNeedsReplacement = minersOnMine.some(creep =>
            !creep.spawning &&
            creep.ticksToLive !== undefined &&
            creep.ticksToLive <= 300
        );

        // Нужно ли срочно создавать сменщика
        const isMinerReplacement =
            minersOnMine.length === mine.desiredMiners &&
            minerNeedsReplacement;

        // Если шахтёров достаточно, дополнительный нужен
        // только для плановой замены
        if (minersOnMine.length >= mine.desiredMiners) {

            if (!minerNeedsReplacement) continue;

            // Если сменщик уже создан, второй не нужен
            if (minersOnMine.length > mine.desiredMiners) continue;
        }

        // Проверяем, достаточно ли энергии для создания
        if (room.energyAvailable < cost) {

            // При срочной плановой замене блокируем
            // создание других ролей до накопления энергии
            if (isMinerReplacement) {
                console.log(
                    "[ШАХТЁР] Ожидаем энергию для сменщика:",
                    "нужно:", cost,
                    "доступно:", room.energyAvailable
                );

                return true;
            }

            // Обычный шахтёр пока не создаётся:
            // можно продолжать проверку остальных ролей
            return false;
        }

        const name = "Miner_" + Game.time;

        const result = spawn.spawnCreep(
            body,
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

        // Попытка спавна выполнена.
        // За этот проход других крипов не создаём.
        return true;
    }

    // Нет шахт, которым сейчас нужен шахтёр
    return false;
}

module.exports = {

    role: "miner",

    getBody: getBody,
    manageSpawning: manageSpawning,

    // Поведение шахтёра
    run: function (creep, homeRoom) {

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
};