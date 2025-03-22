class NovaClicker {
    constructor() {
        this.nova = 0;
        this.nps = 0;
        this.multiplier = 1;
        this.prestige = 0;
        
        this.upgrades = {
            quantum: { 
                level: 0, 
                cost: 50, 
                baseNPS: 1 
            },
            singularity: {
                level: 0,
                cost: 200,
                baseNPS: 5
            },
            chronosphere: {
                level: 0,
                cost: 1000,
                baseNPS: 15
            }
        };

        this.achievements = {
            firstClick: { unlocked: false, title: "Big Bang", desc: "Create your first nova" },
            quantumLeap: { unlocked: false, title: "Quantum Pioneer", desc: "Purchase 10 quantum upgrades" }
        };

        this.init();
    }

    init() {
        this.loadGame();
        this.createUpgradeCards();
        this.setupEventListeners();
        this.gameLoop();
    }

    createUpgradeCards() {
        const container = document.getElementById('upgrades');
        
        Object.entries(this.upgrades).forEach(([id, upgrade]) => {
            const card = document.createElement('div');
            card.className = 'upgrade-card';
            card.innerHTML = `
                <div>
                    <h3>${id.toUpperCase()}</h3>
                    <p>+${upgrade.baseNPS * this.multiplier} NPS</p>
                </div>
                <button class="buy-btn" data-upgrade="${id}">
                    Buy (${Math.floor(upgrade.cost)})
                </button>
            `;
            container.appendChild(card);
        });
    }

    buyUpgrade(upgradeId) {
        const upgrade = this.upgrades[upgradeId];
        if (this.nova >= upgrade.cost) {
            this.nova -= upgrade.cost;
            upgrade.level++;
            upgrade.cost *= 1.15;
            this.nps += upgrade.baseNPS * this.multiplier;
            this.checkAchievements();
            this.updateUI();
        }
    }

    prestige() {
        if (this.nova >= 1e15) {
            this.prestige++;
            this.multiplier *= 2;
            this.resetGame();
            this.showAchievement("Ascended", "Reached cosmic enlightenment", "🌟");
        }
    }

    showAchievement(title, desc, icon) {
        const popup = document.querySelector('.achievement-popup');
        popup.querySelector('.achievement-icon').textContent = icon;
        popup.querySelector('.achievement-title').textContent = title;
        popup.querySelector('.achievement-desc').textContent = desc;
        popup.style.display = 'flex';
        setTimeout(() => popup.style.display = 'none', 3000);
    }

    createParticles(x, y) {
        for (let i = 0; i < 10; i++) {
            const particle = document.createElement('div');
            particle.className = 'particle';
            particle.style.left = `${x}px`;
            particle.style.top = `${y}px`;
            document.querySelector('.particle-container').appendChild(particle);
            setTimeout(() => particle.remove(), 1000);
        }
    }

    updateUI() {
        document.getElementById('nova-count').textContent = Math.floor(this.nova);
        document.getElementById('nps').textContent = this.nps.toFixed(1);
        document.getElementById('multiplier').textContent = `${this.multiplier}x`;
        
        document.querySelectorAll('.buy-btn').forEach(btn => {
            const upgrade = this.upgrades[btn.dataset.upgrade];
            btn.disabled = this.nova < upgrade.cost;
            btn.innerHTML = `Buy (${Math.floor(upgrade.cost)})`;
        });
    }

    gameLoop() {
        setInterval(() => {
            this.nova += this.nps / 10;
            this.updateUI();
            this.saveGame();
        }, 100);
    }

    saveGame() {
        localStorage.setItem('novaClickerSave', JSON.stringify({
            nova: this.nova,
            nps: this.nps,
            multiplier: this.multiplier,
            prestige: this.prestige,
            upgrades: this.upgrades
        }));
    }

    loadGame() {
        const save = JSON.parse(localStorage.getItem('novaClickerSave'));
        if (save) {
            Object.assign(this, save);
            this.updateUI();
        }
    }

    resetGame() {
        this.nova = 0;
        this.nps = 0;
        this.upgrades = {
            quantum: { level: 0, cost: 50, baseNPS: 1 },
            singularity: { level: 0, cost: 200, baseNPS: 5 },
            chronosphere: { level: 0, cost: 1000, baseNPS: 15 }
        };
        this.updateUI();
    }

    setupEventListeners() {
        // Core Click
        document.getElementById('core').addEventListener('click', (e) => {
            this.nova += 1 * this.multiplier;
            this.createParticles(e.clientX, e.clientY);
            if (!this.achievements.firstClick.unlocked) {
                this.showAchievement(this.achievements.firstClick.title, 
                                  this.achievements.firstClick.desc, "🚀");
                this.achievements.firstClick.unlocked = true;
            }
            this.updateUI();
        });

        // Buy Buttons
        document.querySelectorAll('.buy-btn').forEach(btn => {
            btn.addEventListener('click', () => this.buyUpgrade(btn.dataset.upgrade));
        });

        // Tabs
        document.querySelectorAll('.tab').forEach(tab => {
            tab.addEventListener('click', () => {
                document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
                tab.classList.add('active');
                document.querySelectorAll('.tab-content').forEach(content => {
                    content.classList.toggle('active', 
                        content.id === tab.dataset.tab);
                });
            });
        });
    }
}

// Start Game
const game = new NovaClicker();