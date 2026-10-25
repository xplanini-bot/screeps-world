module.exports = {

    role: "attacker",
    desiredCount: 1,

    // Целевая комната.
    // Пустая строка отключает создание нападающего.
    // Пример: "W23S32"
    targetRoom: "",

    // Тело стоимостью 800 энергии
    body: [
        MOVE, MOVE, MOVE, MOVE,
        MOVE, MOVE, MOVE, MOVE,
        ATTACK, ATTACK, ATTACK, ATTACK, ATTACK
    ],

    // Создание нападающего
    manageSpawning: function (spawn) {

        // Без целевой комнаты нападающий не нужен
        if (!this.targetRoom) return;

        // Если спавн занят, ждём
        if (spawn.spawning) return;

        const attackers = Object.values(Game.creeps).filter(
            creep => creep.memory.role === this.role
        );

        // Не создаём второго нападающего
        if (attackers.length >= this.desiredCount) return;

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
                    targetRoom: this.targetRoom
                }
            }
        );

        if (result === OK) {
            console.log(
                "[НАПАДАЮЩИЙ] Создан юнит: " + name +
                ", цель: " + this.targetRoom
            );
        }
    },

    // Поведение нападающего
    runAttacker: function (creep) {

        const targetRoom = creep.memory.targetRoom;

        if (!targetRoom) return;

        // Если находимся не в целевой комнате,
        // идём к её центру
        if (creep.room.name !== targetRoom) {

            const destination = new RoomPosition(
                25,
                25,
                targetRoom
            );

            creep.moveTo(destination, {
                reusePath: 25
            });

            return;
        }

        // Сначала ищем вражеских крипов
        let target = creep.pos.findClosestByRange(
            FIND_HOSTILE_CREEPS
        );

        // Если вражеских крипов нет, ищем вражеские сооружения
        if (!target) {
            target = creep.pos.findClosestByRange(
                FIND_HOSTILE_STRUCTURES
            );
        }

        // Целей нет — ждём
        if (!target) return;

        // Атакуем выбранную цель
        const result = creep.attack(target);

        if (result === ERR_NOT_IN_RANGE) {
            creep.moveTo(target, {
                range: 1,
                reusePath: 5
            });
        }
    }
};