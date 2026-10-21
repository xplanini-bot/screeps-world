
module.exports = {

    // Настройки резервирования
    role: "reserver",
    desiredCount: 1,

    // Пока резервируем только эту комнату
    targetRooms: ["W23S32"],

    // Тело: 2 CLAIM + 2 MOVE = 1300 энергии
    body: [
        CLAIM, CLAIM,
        MOVE, MOVE
    ],


    manageSpawning: function (spawn) {

        if (spawn.spawning) return;

        for (const roomName of this.targetRooms) {

            // Проверяем, есть ли резервист для этой комнаты
            const reserverExists = Object.values(Game.creeps).some(
                creep =>
                    creep.memory.role === this.role &&
                    creep.memory.targetRoom === roomName
            );

            if (reserverExists) continue;

            // Создаём резервиста
            const name = "Reserver_" + roomName + "_" + Game.time;

            const result = spawn.spawnCreep(
                this.body,
                name,
                {
                    memory: {
                        role: this.role,
                        targetRoom: roomName
                    }
                }
            );

            if (result === OK) {
                console.log(
                    "[РЕЗЕРВИСТ] Создан " + name +
                    ", цель: " + roomName
                );
            } else if (result !== ERR_NOT_ENOUGH_ENERGY) {
                console.log(
                    "[РЕЗЕРВИСТ] Ошибка создания: " + result
                );
            }

            // За один вызов создаём максимум одного крипа
            return;
        }
    },

    // Управление резервистом
    run: function (creep) {

        const roomName = creep.memory.targetRoom;

        if (!roomName) return;

        const room = Game.rooms[roomName];

        // Если комната не видна, направляемся к ней
        if (!room) {
            creep.moveTo(
                new RoomPosition(25, 25, roomName),
                { reusePath: 20 }
            );
            return;
        }

        const controller = room.controller;

        if (!controller) return;

        // Не пытаемся резервировать чужой контроллер
        if (controller.owner) return;

        // Подходим к контроллеру
        if (!creep.pos.isNearTo(controller)) {
            creep.moveTo(controller, {
                range: 1,
                reusePath: 20
            });
            return;
        }

        // Резервируем контроллер
        const result = creep.reserveController(controller);

        if (result !== OK && result !== ERR_TIRED) {
            console.log(
                "[РЕЗЕРВИСТ] " + creep.name +
                " ошибка резервирования: " + result
            );
        }
    }
};
