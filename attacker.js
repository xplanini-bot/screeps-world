module.exports = {
    role: "attacker",
    desiredCount: 1,

    healerRole: "attackerHealer",
    healerDesiredCount: 2,

    targetRoom: "",
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

};
