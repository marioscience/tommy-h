/**
 * Stable ARK domain facade.
 *
 * Capacity policy and INI persistence intentionally live in separate modules.
 * Existing routes can keep this import path while each responsibility remains
 * independently auditable and testable.
 */
export { ARK_MINIMUM_REQUIREMENTS, checkArkRequirements } from './ark/requirements.js';
export { getARKConfig, saveARKConfig } from './ark/configStore.js';
