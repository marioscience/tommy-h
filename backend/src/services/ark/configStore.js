import fs from 'fs/promises';
import path from 'path';

// Canonical defaults written under [ServerSettings]. Keep this catalogue in
// one place so UI additions do not leak into capacity or Docker policy.
const DEFAULT_CONFIG = {
    // 1. Platform Options
    PlatformSteam: 'True',
    PlatformWindows: 'True',
    PlatformXbox: 'True',
    PlatformPS5: 'True',

    // 2. Configuración base
    SessionName: 'RageNodes ARK Server',
    ServerPassword: '',
    ServerAdminPassword: 'admin',
    MessageOfTheDay: 'Welcome to RageNodes ARK Server!',
    MessageOfTheDayDuration: '10',
    MapName: 'TheIsland_WP',
    CustomMapName: '',
    RestartCountdown: '60',
    AutoSavePeriodMinutes: '5',
    bItemDupeCheck: 'True',
    bServerGameLog: 'True',
    bAutoRestartOnUpdate: 'True',
    bBattlEye: 'True',
    bDisableCustomCosmeticSystem: 'False',
    bFixThrallStats: 'True',

    // 3. Event
    OfficialServerRates: 'Desactivado',
    EventColors: 'Olympic (-OlympicColors)',
    ActiveEvent: 'Extra Life',

    // 4. Club ARK
    HexagonRewardMultiplier: '500',
    HexagonCostMultiplier: '500',

    // 5. Backup
    BackupToStart: '- comenzar con la partida actual -',

    // 6. Admin-Log
    bAdminLogChat: 'True',
    bIncludeTribeLog: 'True',
    BufferGameLogSize: '600',

    // 7. Restricciones
    bHideDamageFromLogs: 'True',
    bDisableDinoItemBlacklist: 'True',

    // 8. Structure
    bAlwaysAllowStructurePickup: 'True',
    StructurePickupTimeAfterPlacement: '240',
    StructurePickupHoldDuration: '0.5',
    bOverrideStructurePlatformPrevention: 'True',
    bEnableAdditionalStructurePreventionVolumes: 'True',
    bFastDecayUnconnectedCoreStructures: 'True',
    bOnlyAutoDestroyCoreStructures: 'True',
    bAutoDestroyStructures: 'True',
    AutoDestroyOldStructuresMultiplier: '1',
    bDisableStructurePlacementCollision: 'True',
    bEnableHardTurretLimit: 'True',
    bSpikeWallsDamageDinos: 'True',
    MaxStructuresInRange: '10500',
    bAllowTeslaCoilsInCavesForPVP: 'True',
    DinoTurretDamageMultiplier: '1.0',
    StructureResistanceMultiplier: '1.0',
    PlatformSaddleBuildAreaBoundsMultiplier: '1.0',
    StructureResourcePreventionRadiusMultiplier: '1.0',

    // 9. Jugador
    bAllowUnlimitedRespec: 'True',
    bAllowCustomRecipes: 'True',
    PlayerWaterDrainMultiplier: '0.5',
    PlayerStarveMultiplier: '0.5',
    PlayerCharacterStaminaDrainMultiplier: '1.0',
    CustomRecipeEffectivenessMultiplier: '500',
    CustomRecipeSkillMultiplier: '500',
    PlayerHarvestingDamageMultiplier: '1.0',
    PlayerDamageMultiplier: '1.0',
    PlayerResistanceMultiplier: '1.0',
    PlayerCharacterHealthRecoveryMultiplier: '5.0',
    CraftingSkillBonusMultiplier: '500',
    bExclusiveJoin: 'False',
    ExclusiveJoinList: '',
    bForceCharacterRespec: 'False',

    // 10. Jugabilidad
    ShowMapPlayerLocation: 'True',
    ImplantSuicideCountdown: '28800',
    AllowThirdPersonPlayer: 'True',
    bServerCrosshair: 'True',
    bCreativeMode: 'False',
    bEnableMaxDifficulty: 'True',
    bJoinNotifications: 'True',
    bStatusNotifications: 'True',
    bShowFloatingDamageText: 'True',
    bNonPermanentDiseases: 'True',
    bPreventDiseases: 'False',
    bAllowHitIndicators: 'True',
    OverrideOfficialDifficulty: '10.0',
    bAllowLootCrateOnStructures: 'True',
    bAllowMultipleC4Attached: 'True',
    bClampItemSpoilingTimes: 'True',
    ItemStatsClamp: 'False',
    bDisableSpawnAnimation: 'True',
    bWipeAllWildDinos: 'Desactivado',
    bDisableAntiSpeedhack: 'False',
    bAllowFlyerInsideCaves: 'True',
    bAlwaysEnableDedicatedSkeletalMeshes: 'True',
    bDisableLootCrates: 'False',
    bAllowFastLeveling: 'True',
    bEnableMovementSpeedLevelingForFlyers: 'True',
    bDisablePhotoMode: 'False',
    bDeathBeacon: 'True',
    bKickIdlePlayers: 'True',
    KickIdlePlayersPeriod: '3600',
    PhotoModeRangeLimit: '3000',
    MaxPlayerXP: '0',
    MaxDinoXP: '0',
    ItemStackSizeMultiplier: '5.0',

    // 11. Experiencia
    KillXPMultiplier: '10.0',
    HarvestXPMultiplier: '10.0',
    CraftXPMultiplier: '10.0',
    GenericXPMultiplier: '10.0',
    SpecialXPMultiplier: '10.0',
    ExplorerNoteXPMultiplier: '10.0',
    BossKillXPMultiplier: '10.0',
    AlphaKillXPMultiplier: '10.0',
    WildDinoKillXPMultiplier: '10.0',
    CaveKillXPMultiplier: '10.0',
    TamedDinoKillXPMultiplier: '10.0',
    UnclaimedDinoKillXPMultiplier: '10.0',

    // 12. Tribe & Alliance
    bPreventTribeAlliances: 'True',
    bLogTribeDestroyedEnemyStructures: 'True',
    bAllowTribeWarPvE: 'True',
    bAllowTribeWarCancelPvE: 'True',
    TribeNameChangeCooldown: '15',
    MaxTribeLogs: '10',

    // 13. Saddle
    bAllowCryofridgeOnSaddle: 'True',
    bDisableCryopodEnemyCheck: 'True',
    bDisableCryopodFridgeRequirement: 'True',
    CryopodFridgeCooldown: '30',
    bEnableCryoSicknessPVE: 'True',
    bEnableCryopodNerf: 'True',
    CryopodNerfDuration: '0',
    CryopodNerfDamageMultiplier: '0.0099999998',
    CryopodNerfIncomingDamageMultiplier: '0',
    bNotAllowNonAlliedDinoBasing: 'True',
    bAllowMultiFloorsOnPlatformSaddles: 'True',
    PlatformSaddleItemLimitMultiplier: '1.0',

    // 14. PvE / PvP
    PvEmode: 'True',
    bPvETimer: 'True',
    bUseSystemTime: 'True',
    AllowFlyerCarryPvE: 'True',
    bPvPStructureDecay: 'True',
    bPreventOfflinePvP: 'True',
    bPvEAllowStructuresAtSupplyDrops: 'True',
    bPvPDinoDecay: 'True',
    bDisableFriendlyFire: 'True',
    SupplyCrateLootQualityMultiplier: '10000',
    FishingLootQualityMultiplier: '1000',
    PreventOfflinePvPInterval: '800',
    bActivatePVPRespawnInterval: 'True',
    IncreasePvPRespawnIntervalCheckPeriod: '300',
    IncreasePvPRespawnIntervalMultiplier: '2.0',
    IncreasePvPRespawnIntervalBaseAmount: '60',
    AutoPvEStartTimeSeconds: '0',
    AutoPvEStopTimeSeconds: '0',
    DinoDecayMultiplier: '1.0',

    // 15. Baby
    bDisableDinoImprintImprovement: 'True',
    bAnyoneCanCuddleBabyDino: 'True',
    NoWildBabies: 'True',
    MatingIntervalMultiplier: '0.5',
    EggHatchSpeedMultiplier: '5.0',
    BabyMatureSpeedMultiplier: '10.0',
    BabyCuddleIntervalMultiplier: '0.25',
    BabyCuddleGracePeriodMultiplier: '2.0',
    BabyCuddleLoseImprintQualitySpeedMultiplier: '0.5',
    BabyImprintAmountMultiplier: '2.0',
    BabyImprintingStatScaleMultiplier: '2.0',
    BabyFoodConsumptionSpeedMultiplier: '1.0',

    // 16. Farming
    bOptimizeHarvestingAmountMultiplier: 'True',
    CropGrowthSpeedMultiplier: '3.0',
    CropDecaySpeedMultiplier: '1.0',
    ResourceNoClamp: '0.8',
    PlayerResourcePreventionRadiusMultiplier: '1.0',
    HarvestResourceItemHealthMultiplier: '5.0',
    HarvestAmountMultiplier: '5.0',

    // 17. Dino
    bAllowRaidDinoFeeding: 'True',
    bAutoDestroyDecayedDinos: 'True',
    bAllowFlyerStaminaRecovery: 'True',
    bIgnoreMountedWeaponryRestrictionsPVP: 'True',
    DinoCharacterFoodDrainMultiplier: '1.0',
    DinoDamageMultiplier: '1.0',
    DinoResistanceMultiplier: '1.0',
    DinoCharacterStaminaDrainMultiplier: '1.0',
    DinoCharacterHealthRecoveryMultiplier: '10.0',
    DinoHarvestingDamageMultiplier: '3.5',
    LayEggIntervalMultiplier: '1.0',
    PoopIntervalMultiplier: '1.0',
    RaidDinoCharacterFoodDrainMultiplier: '1.0',
    DestroyTamesOverLevelClamp: '15000',
    CosmoWeaponMaxAmmo: '-1',
    CosmoWeaponAmmoReloadAmount: '-1',
    KaijuKingSpawnTime: '15:00:00',
    ArmadoggoCooldown: '3600',

    // 18. Mundo
    GlobalSpoilingTimeMultiplier: '1.0',
    GlobalItemDecompositionTimeMultiplier: '1.0',
    GlobalCorpseDecompositionTimeMultiplier: '1.0',
    FuelConsumptionIntervalMultiplier: '1.0',

    // 19. Taming
    MaxTamedDinos: '5000',
    bDisableDinoRiding: 'True',
    bDisableDinoTaming: 'True',
    TamingSpeedMultiplier: '5.0',

    // 20. Tek Bunker
    bLimitsBunkerPerTribe: 'True',
    TribeBunkerLimitAmount: '3',
    bBunkersInPreventionZones: 'True',
    bDinoRidingInsideBunkers: 'True',
    bBunkerModulesAboveGround: 'True',
    bDinoAIInBunkers: 'True',
    bBunkerModulesInPreventionZones: 'True',
    MinDistanceBetweenBunkers: '3000.0',
    EnemyAccessBunkerHPThreshold: '0.25',
    DamageMultiplierBelowBunkerHPThreshold: '0.05',

    // 21. Cryo Hospital
    CryoHospitalHPRegeneration: '0.5',
    CryoHospitalFoodRegeneration: '8',
    CryoHospitalTuporDraining: '1.0',
    CryoHospitalMatingCooldownReduction: '3',

    // 22. Bloodforge
    BloodforgeReinforceExtraDurability: '0.5',
    BloodforgeReinforceResourceCostMultiplier: '5.0',
    BloodforgeReinforceSpeedMultiplier: '0.5',

    // 23. Outposts
    ActiveOutpostMaximum: '10',
    ActiveResourceCashesMaximum: '10',
    ActiveCityOutpostMaximum: '10',
};

/**
 * Lee la configuración de ARK: Survival Ascended desde GameUserSettings.ini
 */
export async function getARKConfig(instancePath) {
    const cfgPath = path.join(instancePath, 'common', 'ARK Survival Ascended Dedicated Server', 'ShooterGame', 'Saved', 'Config', 'WindowsServer', 'GameUserSettings.ini');
    try {
        const content = await fs.readFile(cfgPath, 'utf8');
        const config = { ...DEFAULT_CONFIG, clusterid: '' };
        content.replace(/\r/g, '').split('\n').forEach(line => {
            const match = line.match(/^([^=\n]+)=(.*)$/);
            if (match) {
                const key = match[1].trim();
                if (key in DEFAULT_CONFIG || key.toLowerCase() === 'clusterid') config[key] = match[2].trim();
            }
        });
        return config;
    } catch (e) {
        return { ...DEFAULT_CONFIG, clusterid: '' };
    }
}

/**
 * Guarda la configuración en GameUserSettings.ini
 */
export async function saveARKConfig(instancePath, config, clusterId = null) {
    const cfgDir = path.join(instancePath, 'common', 'ARK Survival Ascended Dedicated Server', 'ShooterGame', 'Saved', 'Config', 'WindowsServer');
    const cfgPath = path.join(cfgDir, 'GameUserSettings.ini');
    await fs.mkdir(cfgDir, { recursive: true });

    let content = '';
    try {
        content = await fs.readFile(cfgPath, 'utf8');
    } catch (e) {
        content = '[ServerSettings]\n';
    }

    if (!content.includes('[ServerSettings]')) {
        content = '[ServerSettings]\n' + content;
    }

    const merged = { ...DEFAULT_CONFIG, ...config };
    if (clusterId) {
        merged.clusterid = clusterId;
    }

    for (const [key, value] of Object.entries(merged)) {
        const regex = new RegExp(`^${key}=.*$`, 'm');
        if (regex.test(content)) {
            content = content.replace(regex, `${key}=${value}`);
        } else {
            content = content.replace(/\[ServerSettings\]/, `[ServerSettings]\n${key}=${value}`);
        }
    }

    await fs.writeFile(cfgPath, content, 'utf8');
}
