
module.exports = {

    // Роль бешеного шахтёра
    role: "berserkMiner",

    // Пока создаём одного шахтёра
    desiredCount: 1,

    // Комната, которую будет защищать боевой отряд
    targetRoom: "W23S32",

    // Тело: 6 WORK и 6 MOVE
    body: [
        WORK, WORK, WORK,
        WORK, WORK, WORK,

        MOVE, MOVE, MOVE,
        MOVE, MOVE, MOVE
    ],

    // Создание бешеного шахтёра
    manageSpawning: function (spawn) {

        if (spawn.spawning) return;

        // Считаем шахтёров, назначенных в целевую комнату
        const miners = Object.values(Game.creeps).filter(
            creep =>
                creep.memory.role === this.role &&
                creep.memory.targetRoom === this.targetRoom
        );

        if (miners.length >= this.desiredCount) return;

        // Рассчитываем стоимость тела
        const cost = this.body.reduce(
            (total, part) => total + BODYPART_COST[part],
            0
        );

        if (spawn.room.energyAvailable < cost) return;

        const name = "BerserkMiner_" + Game.time;

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
                "[БЕШЕНЫЙ ШАХТЁР] Создан: " +
                name +
                ", цель: " + this.targetRoom
            );
        }
    }
};
