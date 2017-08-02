'use strict';

let _ = require('lodash');
let storageSettings = require('./storageSettings');
let nicSettings = require('./networkInterfaceSettings');
let avSetSettings = require('./availabilitySetSettings');
let lbSettings = require('./loadBalancerSettings');
let resources = require('./resources');
let v = require('./validation');
let vmDefaults = require('./virtualMachineSettingsDefaults');
let vmExtensions = require('./virtualMachineExtensionsSettings');
let scaleSetSettings = require('./virtualMachineScaleSetSettings');
const os = require('os');

function merge({ settings, buildingBlockSettings, defaultSettings }) {
    if (v.utilities.isNullOrWhitespace(settings.osType)) {
        settings.osType = 'linux';
    } else if (!isValidOSType(_.toLower(settings.osType))) {
        throw new Error(JSON.stringify({
            name: '.osType',
            message: `Invalid value: ${settings.osType}. Valid values for 'osType' are: ${validOSTypes.join(', ')}`
        }));
    }

    // Get the defaults for the OSType selected
    let defaults = _.cloneDeep((_.toLower(settings.osType) === 'windows') ? vmDefaults.defaultWindowsSettings : vmDefaults.defaultLinuxSettings);

    defaults = (defaultSettings) ? [defaults, defaultSettings] : defaults;

    // if load balancer is required, loadBalancerSettings property needs to be specified in parameter
    if (_.isNil(settings.loadBalancerSettings)) {
        // If parameter doesnt have a loadBalancerSettings property, then remove it from defaults as well
        delete defaults.loadBalancerSettings;
    } else if (v.utilities.isNullOrWhitespace(settings.loadBalancerSettings.name) &&
        (_.isNil(defaultSettings) || _.isNil(defaultSettings.loadBalancerSettings) || v.utilities.isNullOrWhitespace(defaultSettings.loadBalancerSettings.name))) {
        settings.loadBalancerSettings.name = `${settings.namePrefix}-lb`;
    }

    // if scaleset is required, scaleSetSettings property needs to be specified in parameter
    if (_.isNil(settings.scaleSetSettings)) {
        // If parameter doesnt have a scaleSetSettings property, then remove it from defaults as well
        delete defaults.scaleSetSettings;
    } else if (v.utilities.isNullOrWhitespace(settings.scaleSetSettings.name) &&
        (_.isNil(defaultSettings) || _.isNil(defaultSettings.scaleSetSettings) || v.utilities.isNullOrWhitespace(defaultSettings.scaleSetSettings.name))) {
        settings.scaleSetSettings.name = `${settings.namePrefix}-ss`;
    }

    // TODO - fromImage settings
    // We need to modify defaults based on some values in settings in order to support the different createOption settings
    if (settings.storageAccounts.managed) {
        if (settings.osDisk.createOption === 'attach') {
            delete defaults.imageReference;
        }
    } else {
        if (((settings.osDisk.createOption === 'fromImage') && (settings.osDisk.image)) ||
            (settings.osDisk.createOption === 'attach')) {
            delete defaults.imageReference;
        }
    }

    let merged = v.merge(settings, defaults, (objValue, srcValue, key) => {
        if (key === 'storageAccounts') {
            return storageSettings.storageMerge({
                settings: srcValue,
                buildingBlockSettings: buildingBlockSettings,
                defaultSettings: objValue
            });
        }
        if (key === 'diagnosticStorageAccounts') {
            return storageSettings.diagnosticMerge({
                settings: srcValue,
                buildingBlockSettings: buildingBlockSettings,
                defaultSettings: objValue
            });
        }
        if (key === 'availabilitySet') {
            return avSetSettings.merge({
                settings: srcValue,
                buildingBlockSettings: buildingBlockSettings,
                defaultSettings: objValue
            });
        }
        if (key === 'nics') {
            return nicSettings.merge({
                settings: srcValue,
                buildingBlockSettings: buildingBlockSettings,
                defaultSettings: objValue
            });
        }
        if (key === 'loadBalancerSettings') {
            return lbSettings.merge({
                settings: srcValue,
                buildingBlockSettings: buildingBlockSettings,
                defaultSettings: objValue
            });
        }
        if (key === 'imageReference') {
            if (!_.isEmpty(srcValue)) {
                return srcValue;
            }
        }
        if (key === 'scaleSetSettings') {
            return scaleSetSettings.merge({
                settings: srcValue,
                buildingBlockSettings: buildingBlockSettings,
                defaultSettings: objValue
            });
        }
    });

    // Add resourceGroupName and SubscriptionId to resources
    let updatedSettings = resources.setupResources(merged, buildingBlockSettings, (parentKey) => {
        return ((parentKey === null) || (v.utilities.isStringInArray(parentKey,
            ['virtualNetwork', 'availabilitySet', 'nics', 'diagnosticStorageAccounts', 'storageAccounts', 'loadBalancerSettings', 'encryptionSettings', 'scaleSetSettings', 'publicIpAddress'])));
    });

    let normalized = NormalizeProperties(updatedSettings);
    return normalized;
}

function NormalizeProperties(settings) {
    let updatedSettings = _.cloneDeep(settings);

    // computerNamePrefix
    // if computerNamePrefix is not specified, use namePrefix
    if (v.utilities.isNullOrWhitespace(updatedSettings.computerNamePrefix) && !v.utilities.isNullOrWhitespace(updatedSettings.namePrefix)) {
        updatedSettings.computerNamePrefix = updatedSettings.namePrefix;
    }

    // loadBalancerSettings
    if (!_.isNil(updatedSettings.loadBalancerSettings)) {
        // if loadBalancerSettings is specified, add vmCount and virtualNetwork info from vm settings to the LB settings
        updatedSettings.loadBalancerSettings.vmCount = updatedSettings.vmCount;
        updatedSettings.loadBalancerSettings.virtualNetwork = updatedSettings.virtualNetwork;
    }

    if (!_.isNil(updatedSettings.scaleSetSettings)) {
        let autoScale = updatedSettings.scaleSetSettings.autoScaleSettings;

        if (v.utilities.isNullOrWhitespace(autoScale.name)) {
            autoScale.name = `${updatedSettings.scaleSetSettings.name}-auto`;
        }
        if (v.utilities.isNullOrWhitespace(autoScale.targetResourceUri)) {
            autoScale.targetResourceUri = resources.resourceId(settings.subscriptionId, settings.resourceGroupName, 'Microsoft.Compute/virtualMachineScaleSets', updatedSettings.scaleSetSettings.name);
        }

        autoScale.profiles.forEach((p) => {
            if (_.isNil(p.capacity) || _.isEmpty(p.capacity)) {
                p.capacity = {
                    minimum: _.ceil(updatedSettings.vmCount / 2),
                    maximum: updatedSettings.vmCount * 2,
                    default: updatedSettings.vmCount
                };
            }
            p.rules.forEach((r) => {
                if (v.utilities.isNullOrWhitespace(r.metricTrigger.metricResourceUri)) {
                    r.metricTrigger.metricResourceUri = resources.resourceId(settings.subscriptionId, settings.resourceGroupName, 'Microsoft.Compute/virtualMachineScaleSets', updatedSettings.scaleSetSettings.name);
                }
            });
        });
    }

    // availabilitySet
    // if vmCount is greater than 1 and availabilitySet is not specified, we need to create one
    if (_.isFinite(updatedSettings.vmCount) && updatedSettings.vmCount > 1) {
        if (_.isNil(updatedSettings.availabilitySet.name)) {
            updatedSettings.availabilitySet.name = `${updatedSettings.namePrefix}-as`;
        }
    }

    // osType
    updatedSettings.osType = _.toLower(updatedSettings.osType);

    // createOption
    if (!_.isNil(updatedSettings.osDisk) && !v.utilities.isNullOrWhitespace(updatedSettings.osDisk.createOption)) {
        if (_.toLower(updatedSettings.osDisk.createOption) === 'fromimage') {
            updatedSettings.osDisk.createOption = 'fromImage';
        } else {
            updatedSettings.osDisk.createOption = _.toLower(updatedSettings.osDisk.createOption);
        }
    }

    if (!_.isNil(updatedSettings.dataDisks) && !_.isNil(updatedSettings.dataDisks)
        && !v.utilities.isNullOrWhitespace(updatedSettings.dataDisks.createOption)) {
        if (_.toLower(updatedSettings.dataDisks.createOption) === 'fromimage') {
            updatedSettings.dataDisks.createOption = 'fromImage';
        } else {
            updatedSettings.dataDisks.createOption = _.toLower(updatedSettings.dataDisks.createOption);
        }
    }

    return updatedSettings;
}

let validOSTypes = ['linux', 'windows'];
let validCachingType = ['None', 'ReadOnly', 'ReadWrite'];
let validOsDiskCreateOptions = ['fromImage', 'attach'];
let validDataDiskCreateOptions = ['fromImage', 'empty', 'attach'];

let isValidOSType = (osType) => {
    return v.utilities.isStringInArray(osType, validOSTypes);
};

let isValidCachingType = (caching) => {
    return v.utilities.isStringInArray(caching, validCachingType);
};

let isValidOsDiskCreateOptions = (option) => {
    return v.utilities.isStringInArray(option, validOsDiskCreateOptions);
};

let isValidDataDiskCreateOptions = (option) => {
    return v.utilities.isStringInArray(option, validDataDiskCreateOptions);
};

function validate(settings) {
    return v.validate({
        settings: settings,
        validations: virtualMachineValidations
    });
}

let encryptionSettingsValidations = {
    enabled: _.isBoolean,
    diskEncryptionKey: {
        secretUrl: v.validationUtilities.isNotNullOrWhitespace,
        sourceVaultName: v.validationUtilities.isNotNullOrWhitespace
    },
    keyEncryptionKey: {
        keyUrl: v.validationUtilities.isNotNullOrWhitespace,
        sourceVaultName: v.validationUtilities.isNotNullOrWhitespace
    }
};

let virtualMachineValidations = {
    virtualNetwork: (value, parent) => {
        if (_.isNil(parent.scaleSetSettings) && value.location !== parent.location) {
            return {
                result: false,
                message: 'Virtual Machine must be the same location than Virtual Network'
            };
        }
        let virtualNetworkValidations = {
            name: v.validationUtilities.isNotNullOrWhitespace
        };

        return {
            validations: virtualNetworkValidations
        };
    },
    vmCount: (value) => {
        return {
            result: _.isFinite(value) && (value > 0),
            message: 'Value must be greater than 0'
        };
    },
    namePrefix: v.validationUtilities.isNotNullOrWhitespace,
    computerNamePrefix: (value) => {
        return {
            result: (!v.utilities.isNullOrWhitespace(value)) && (value.length < 8),
            message: 'Value cannot be longer than 7 characters'
        };
    },
    size: v.validationUtilities.isNotNullOrWhitespace,
    osType: (value) => {
        return {
            result: isValidOSType(value),
            message: `Valid values are ${validOSTypes.join(', ')}`
        };
    },
    osDisk: (value, parent) => {
        // We will need this, so we'll capture here.
        let isManagedStorageAccounts = parent.storageAccounts.managed;
        let imageReference = parent.imageReference;
        let vmCount = parent.vmCount;
        let osDiskValidations = {
            caching: (value) => {
                return {
                    result: isValidCachingType(value),
                    message: `Valid values are ${validCachingType.join(', ')}`
                };
            },
            createOption: (value) => {
                if (!isValidOsDiskCreateOptions(value)) {
                    return {
                        result: false,
                        message: `Valid values are ${validOsDiskCreateOptions.join(', ')}`
                    };
                }

                return { result: true };
            },
            image: (value, parent) => {
                // If we are using unmanaged disks, this field serves two purposes.
                // 1.  If createOption is fromImage, and imageReference is not specified, it must be a single-element array pointing to a blob
                //     with a generalized disk image
                // 2.  If createOption is attach, it must be an array with vmCount elements pointing to different non-generalized blob images
                if (parent.createOption === 'fromImage') {
                    if (isManagedStorageAccounts) {
                        if (!_.isUndefined(value)) {
                            return {
                                result: false,
                                message: '.osDisk.image cannot be specified if using managed storage accounts'
                            };
                        }
                    } else {
                        let isValidImageValue = (!_.isNil(value)) && (_.isArray(value)) || (value.length === 1);
                        if (((_.isNil(imageReference)) && (!isValidImageValue)) ||
                        ((!_.isNil(imageReference)) && (isValidImageValue))) {
                            return {
                                result: false,
                                message: 'Either .imageReference or a 1-element array .osDisk.image must be specified if value of .osDisk.createOption is fromImage, but not both'
                            };
                        }
                    }
                }
                else if (parent.createOption === 'attach') {
                    // In this case, managed and unmanaged are the same.  But imageReference cannot be specified.
                    if (!_.isNil(imageReference)) {
                        return {
                            result: false,
                            message: '.imageReference cannot be specified if .osDisk.createOption is attach'
                        };
                    } else if ((_.isNil(value)) || (!_.isArray(value)) || (value.length !== vmCount)) {
                        return {
                            result: false,
                            message: 'If .osDisk.createOption is attach, .osDisk.image must be an array with a length of vmCount pointing to storage blobs (for unmanaged) or Microsoft.Compute/disks resources (for managed)'
                        };
                    }
                }

                return { result: true };
            },
            diskSizeGB: (value) => {
                return _.isNil(value) ? {
                    result: true
                } : {
                        result: ((_.isFinite(value)) && value > 0),
                        message: 'Value must be greater than 0'
                    };
            },
            encryptionSettings: (value) => {
                return _.isNil(value) ? {
                    result: true
                } : {
                        validations: encryptionSettingsValidations
                    };
            }
        };

        return {
            validations: osDiskValidations
        };
    },
    dataDisks: (value, parent) => {
        // We will need this, so we'll capture here.
        let isManagedStorageAccounts = parent.storageAccounts.managed;
        let vmCount = parent.vmCount;
        let dataDiskValidations = {
            caching: (value) => {
                return {
                    result: isValidCachingType(value),
                    message: `Valid values are ${validCachingType.join(', ')}`
                };
            },
            createOption: (value) => {
                if (!isValidDataDiskCreateOptions(value)) {
                    return {
                        result: false,
                        message: `Valid values are ${validDataDiskCreateOptions.join(', ')}`
                    };
                }

                if (isManagedStorageAccounts && value === 'attach') {
                    return {
                        result: false,
                        message: 'Value cannot be attach with managed disks'
                    };
                }
                return { result: true };
            },
            disks: (value, parent) => {
                return {
                    validations: (value) => {
                        // attach is the same for both managed and unmanaged disks.
                        if (value.createOption === 'attach') {
                            // Make sure the length of images is the same as vmcount
                            if ((_.isNil(value.images)) || (value.images.length !== vmCount)) {
                                return {
                                    result: false,
                                    message: `images cannot be null or undefined and must match the vmCount of ${vmCount}`
                                };
                            }

                            // Make sure that all values are arrays and that they are not null or undefined
                            if (_.some(value.images, (value) => {
                                return _.isNil(value) || !_.isArray(value) || (value.length === 0);
                            })) {
                                return {
                                    result: false,
                                    message: 'images must contain only arrays that are not null, undefined, or have a length of 0'
                                };
                            }

                            // Make sure the arrays are all the same length
                            let firstLength = value.images[0].length;
                            if (!_.every(value.images, (value) => {
                                return value.length === firstLength;
                            })) {
                                return {
                                    result: false,
                                    message: 'images must contain arrays that all have the same length'
                                };
                            }

                            // Make sure all of the arrays are all strings and are not undefined, null, or only whitespace
                            if (_.some(value.images, (value) => {
                                return _.some(value, (value) => {
                                    return v.utilities.isNullOrWhitespace(value);
                                });
                            })) {
                                return {
                                    result: false,
                                    message: 'images must contain string values that are not undefined, null, or only whitespace'
                                };
                            }
                        } else if (value.createOption === 'fromImage') {
                            if (isManagedStorageAccounts) {
                                // For fromImage and managed accounts, the images are contained within the Microsoft.Compute/images resource,
                                // so if images is specified, we should fail
                                if (!_.isUndefined(value.images)) {
                                    return {
                                        result: false,
                                        message: 'images cannot be specified with fromImage for managed disks'
                                    };
                                }
                            } else {
                                // Make sure the length of images is 1, and not null, empty, or only whitespace.
                                if (_.isNil(value.images) || !_.isArray(value.images) || (value.images.length !== 1) || v.utilities.isNullOrWhitespace(value.images[0])) {
                                    return {
                                        result: false,
                                        message: 'images must be a 1-element array pointing to a storage blob containing a disk image'
                                    };
                                }
                            }
                        }

                        return { result: true };
                    }
                };
            },
            diskSizeGB: (value) => {
                return {
                    result: ((_.isFinite(value)) && value > 0),
                    message: 'Value must be greater than 0'
                };
            },
            count: (value) => {
                return {
                    result: ((_.isFinite(value))),
                    message: 'Invalid value for count'
                };
            }
        };

        return {
            validations: dataDiskValidations
        };
    },
    existingWindowsServerlicense: (value, parent) => {
        if (_.isNil(value)) {
            return { result: true };
        }
        if (!_.isBoolean(value)) {
            return {
                result: false,
                message: 'Value must be Boolean'
            };
        }

        if (parent.osType !== 'windows' && value) {
            return {
                result: false,
                message: 'Value cannot be true, if the osType is windows'
            };
        }
        return { result: true };
    },
    adminUsername: (value) => {
        if (_.isNil(value) || _.isEmpty(value)) {
            return {
                result: false,
                name: '.adminUsername',
                message: 'adminUsername cannot be null or empty'
            };
        }
        if (value.length > 20 || value.substr(value.length -1) === '.') {
            return {
                result: false,
                name: '.adminUsername',
                message: 'adminUsername cannot be more than 20 characters long o end with a period(.)'
            };
        }
        if (v.isInvalidUsername(value)) {
            return {
                result: false,
                name: '.adminUsername',
                message: 'adminUsername cannot contains these characters: " [ ] : | < > + = ; , ? * @'
            };
        }
        return { result: true };
    },
    adminPassword: (value, parent) => {
        let result = {
            result: true
        };
        if (v.utilities.isNullOrWhitespace(value)) {
            if (parent.osType === 'windows') {
                return {
                    result: false,
                    message: 'adminPassword cannot be null, empty, or only whitespace if osType is windows'
                };
            }
            if (_.isNil(parent.sshPublicKey) || v.utilities.isNullOrWhitespace(parent.sshPublicKey)) {
                return {
                    result: false,
                    message: 'adminPassword and sshPublicKey cannot both be null or empty'
                };
            }
            return result;
        }
        if (value.length < 6 || value.length > 72) {
            return {
                result: false,
                name: '.adminPassword',
                message: 'The supplied password must be between 6-72 characters long'
            };
        }
        if (v.isInvalidPassword(value)) {
            return {
                result: false,
                name: '.adminPassword',
                message: 'The supplied password must satisfy at least 3 of password complexity requirements from the following: 1) Contains an uppercase character, 2) Contains a lowercase character, 3) Contains a numeric digit, 4) Contains a special character'
            };
        }
        return result;
    },
    sshPublicKey: (value, parent) => {
        let result = {
            result: true
        };
        if ((parent.osType === 'windows') && (!_.isNil(value))) {
            result = {
                result: false,
                message: 'sshPublicKey cannot be specified if osType is windows'
            };
        } else if ((parent.osType === 'linux') && v.utilities.isNullOrWhitespace(parent.adminPassword) && v.utilities.isNullOrWhitespace(value)) {
            result = {
                result: false,
                message: 'Both adminPassword and sshPublicKey cannot be null, empty, or only whitespace if osType is linux'
            };
        } else if ((parent.osType === 'linux') && !v.utilities.isNullOrWhitespace(value) && !v.utilities.isNullOrWhitespace(parent.adminPassword)) {
            result = {
                result: false,
                message: 'sshPublicKey cannot be provided if adminPassword is provided'
            };
        }
        return result;
    },
    storageAccounts: (value, parent) => {
        if (value.location !== parent.location || value.subscriptionId !== parent.subscriptionId) {
            return {
                result: false,
                message: 'Virtual Machine must be in the same location and subscription than storage account'
            };
        }
        let result = {
            validations: storageSettings.storageValidations
        };
        return result;
    },
    diagnosticStorageAccounts: (value, parent) => {
        if (value.location !== parent.location || value.subscriptionId !== parent.subscriptionId) {
            return {
                result: false,
                message: 'Virtual Machine must be in the same location and subscription than diagnostic storage account'
            };
        }
        let result = {
            validations: storageSettings.diagnosticValidations
        };
        return result;
    },
    nics: (value, parent) => {
        let result = {
            validations: nicSettings.validations
        };

        if ((!_.isNil(value)) && (value.length > 0)) {
            if ((_.filter(value, (o) => { return (_.isBoolean(o.isPrimary) && o.isPrimary); })).length !== 1) {
                return {
                    result: false,
                    message: 'Virtual machine must have only 1 primary NetworkInterface.'
                };
            } else if (!_.isNil(parent.loadBalancerSettings)) {
                let errorMsg = '';
                value.forEach((nic, index) => {
                    nic.backendPoolsNames.forEach((bep) => {
                        if (!(_.map(parent.loadBalancerSettings.backendPools, (o) => { return o.name; })).includes(bep)) {
                            errorMsg += `BackendPool ${bep} specified in nic[${index}] is not valid.${os.EOL}`;
                        }
                    });
                    nic.inboundNatRulesNames.forEach((nat) => {
                        if (!(_.map(parent.loadBalancerSettings.inboundNatRules, (o) => { return o.name; })).includes(nat)) {
                            errorMsg += `InboundNatRule ${nat} specified in nic[${index}] is not valid.${os.EOL}`;
                        }
                    });
                    nic.inboundNatPoolNames.forEach((pool) => {
                        if (!(_.map(parent.loadBalancerSettings.inboundNatPools, (o) => { return o.name; })).includes(pool)) {
                            errorMsg += `InboundNatPool ${pool} specified in nic[${index}] is not valid.${os.EOL}`;
                        }
                    });
                });
                if (!v.utilities.isNullOrWhitespace(errorMsg)) {
                    return {
                        result: false,
                        message: errorMsg
                    };
                }

            }
            else if (_.isNil(parent.scaleSetSettings)) {
                let errorMsg = '';
                value.forEach((nic, index) => {
                    if (nic.location !== parent.location || nic.subscriptionId !== parent.subscriptionId) {
                        errorMsg += `Virtual Machine must be in the same location and subscription than network interface: nic[${index}]`;
                    }
                });
                if (!v.utilities.isNullOrWhitespace(errorMsg)) {
                    return {
                        result: false,
                        message: errorMsg
                    };
                }
            }
        } else {
            return {
                result: false,
                message: 'Virtual machine must have 1 primary NetworkInterface.'
            };
        }
        return result;
    },
    availabilitySet: (value, parent) => {
        if (v.utilities.isNullOrWhitespace(value.name)) {
            return { result: true };
        }
        if (value.resourceGroupName !== parent.resourceGroupName || value.location !== parent.location
            || value.subscriptionId !== parent.subscriptionId) {
            return {
                result: false,
                message: 'Virtual Machine must be in the same resource group, location and subscription than Availability Set'
            };
        }
        return {
            validations: avSetSettings.validations
        };
    },
    tags: v.tagsValidations,
    loadBalancerSettings: (value, parent) => {
        if (_.isNil(value)) {
            return { result: true };
        } else if (_.isNil(parent.scaleSetSettings) && value.inboundNatPools.length > 0) {
            return {
                result: false,
                message: '.loadBalancerSettings.inboundNatPools can only be specified with scalesets'
            };
        }
        if (value.subscriptionId !== parent.subscriptionId) {
            return {
                result: false,
                message: 'Virtual Machine must be in the same subscription than Load Balancer'
            };
        }
        return {
            validations: lbSettings.validations
        };
    },
    scaleSetSettings: (value, parent) => {
        if (_.isNil(value)) {
            return { result: true };
        }
        if (!_.isNil(parent.osDisk.encryptionSettings)) {
            return {
                result: false,
                message: '.osDisk.encryptionSettings cannot be provided for scalesets.'
            };
        }
        if (!_.isNil(parent.dataDisks.properties.image)) {
            return {
                result: false,
                message: '.dataDisks.properties.image cannot be provided for scalesets.'
            };
        }
        if (value.location !== parent.virtualNetwork.location || value.subscriptionId !== parent.virtualNetwork.subscriptionId) {
            return {
                result: false,
                message: 'Scale set must be in the same location and subscription than virtual network'
            };
        }
        let errorMsg = '';
        parent.nics.forEach((nic, index) => {
            if (value.subscriptionId !== nic.subscriptionId) {
                errorMsg += 'Scale set must be in the same subscription than nic[' + index + ']';
            }
        });
        if (!v.utilities.isNullOrWhitespace(errorMsg)) {
            return {
                result: false,
                message: errorMsg
            };
        }

        return {
            validations: scaleSetSettings.validations
        };
    },
    extensions: (value, parent) => {
        if (_.isNil(value)) {
            return { result: true };
        }
        value.forEach((ext) => {
            if (!_.isNil(parent.scaleSetSettings) && ext.protectedSettings.hasOwnProperty('reference') && ext.protectedSettings.reference.hasOwnProperty('keyVault')) {
                return {
                    result: false,
                    message: '.extensions.protectedSettings cannot be KeyVault reference for scalesets'
                };
            }
        });

        return {
            validations: vmExtensions.validations
        };
    }

};

let processorProperties = {
    existingWindowsServerlicense: (value, key, index, parent) => {
        if (parent.osType === 'windows' && value) {
            return {
                licenseType: 'Windows_Server'
            };
        } else {
            return;
        }
    },
    availabilitySet: (value) => {
        if (v.utilities.isNullOrWhitespace(value.name)) {
            return {
                availabilitySet: null
            };
        }

        return {
            availabilitySet: {
                id: resources.resourceId(value.subscriptionId, value.resourceGroupName, 'Microsoft.Network/availabilitySets', value.name)
            }
        };
    },
    size: (value) => {
        return {
            hardwareProfile: {
                vmSize: value
            }
        };
    },
    imageReference: (value, key, index, parent) => {
        if (parent.osDisk.createOption === 'fromImage') {
            if ((parent.storageAccounts.managed) || (!parent.osDisk.image)) {
                return {
                    storageProfile: {
                        imageReference: value
                    }
                };
            }
        }
    },
    osDisk: (value, key, index, parent, parentAccumulator, buildingBlockSettings) => {
        let instance = {
            name: parent.name.concat('-os'),
            createOption: value.createOption,
            caching: value.caching,
            osType: parent.osType
        };

        if (value.hasOwnProperty('diskSizeGB')) {
            instance.diskSizeGB = value.diskSizeGB;
        }

        if (value.encryptionSettings) {
            instance.encryptionSettings = {
                diskEncryptionKey: {
                    secretUrl: value.encryptionSettings.diskEncryptionKey.secretUrl,
                    sourceVault: {
                        id: resources.resourceId(value.encryptionSettings.subscriptionId, value.encryptionSettings.resourceGroupName, 'Microsoft.KeyVault/vaults', value.encryptionSettings.diskEncryptionKey.sourceVaultName)
                    }
                },
                keyEncryptionKey: {
                    keyUrl: value.encryptionSettings.keyEncryptionKey.keyUrl,
                    sourceVault: {
                        id: resources.resourceId(value.encryptionSettings.subscriptionId, value.encryptionSettings.resourceGroupName, 'Microsoft.KeyVault/vaults', value.encryptionSettings.keyEncryptionKey.sourceVaultName)
                    }
                },
                enabled: true
            };
        }

        if (value.createOption === 'attach') {
            if (parent.storageAccounts.managed) {
                // name cannot be changed for an attached, managed disk
                delete instance.name;
                instance.managedDisk = {
                    id: value.image[index]
                };
            } else {
                instance.vhd = {
                    uri: value.image[index]
                };
            }
        } else if (value.createOption === 'fromImage') {
            if (parent.storageAccounts.managed) {
                instance.managedDisk = {
                    storageAccountType: parent.storageAccounts.skuType
                };
            } else {
                let storageAccounts = _.cloneDeep(parent.storageAccounts.accounts);
                parentAccumulator.storageAccounts.forEach((account) => {
                    storageAccounts.push(account.name);
                });
                let storageAccountToUse = index % storageAccounts.length;
                instance.vhd = {
                    uri: `http://${storageAccounts[storageAccountToUse]}.blob.${buildingBlockSettings.cloud.suffixes.storageEndpoint}/vhds/${parent.name}-os.vhd`
                };

                // This is handled one of two ways for unmanaged.  If we are using "standard" images, the imageReference object is used.
                // If we are using custom images, the image field should point to the image we want to use.
                if (value.image) {
                    instance.image = {
                        uri: value.image[0]
                    };
                }
            }
        }

        return {
            storageProfile: {
                osDisk: instance
            }
        };
    },
    dataDisks: (value, key, index, parent, parentAccumulator, buildingBlockSettings) => {
        let disks = [];
        if (value.disks) {
            // If we have non-empty data disks...
            for (let i = 0; i < value.disks.length; i++) {
                if (value.disks[i].createOption === 'fromImage') {
                    if (parent.storageAccounts.managed) {
                        // fromImage uses the imageReference property for managed data disks
                        let disk = {
                            createOption: 'fromImage',
                            caching: value.disks[i].caching ? value.disks[i].caching : value.caching
                        };

                        disks.push(disk);
                    }
                    else {
                        for (let j = 0; j < value.disks[i].images.length; j++) {
                            let disk = {
                                createOption: 'fromImage',
                                caching: value.disks[i].caching ? value.disks[i].caching : value.caching,
                                image: {
                                    uri: value.disks[i].images[j]
                                }
                            };

                            disks.push(disk);
                        }
                    }
                } else if (value.disks[i].createOption === 'attach') {
                    // This is an array of arrays containing blob uris or Microsoft.Compute/disk resource Ids
                    for (let j = 0; j < value.disks[i].images[index].length; j++) {
                        let disk = {
                            createOption: 'attach',
                            caching: value.disks[i].caching ? value.disks[i].caching : value.caching
                        };

                        if (parent.storageAccounts.managed) {
                            disk.managedDisk = {
                                id: value.disks[i].images[index][j]
                            };
                        } else {
                            disk.vhd = {
                                uri: value.disks[i].images[index][j]
                            };
                        }
                        disks.push(disk);
                    }
                }
            }
        }

        // We have gone through the disks array, so now we need to fill up the rest with emptys
        // _.times() returns an empty array if value.count - disks.length is <= 0, which is what we want.
        disks = disks.concat(_.times(value.count - disks.length, () => {
            return {
                diskSizeGB: value.diskSizeGB,
                caching: value.caching,
                createOption: 'empty'
            };
        }));

        // Now go through and name and number
        for (let i = 0; i < disks.length; i++) {
            disks[i].name = `${parent.name}-dataDisk${i + 1}`;
            disks[i].lun = i;
            if ((disks[i].createOption === 'empty') || (disks[i].createOption === 'fromImage')) {
                if (!parent.storageAccounts.managed) {
                    let storageAccounts = _.cloneDeep(parent.storageAccounts.accounts);
                    parentAccumulator.storageAccounts.forEach((account) => {
                        storageAccounts.push(account.name);
                    });
                    let storageAccountToUse = index % storageAccounts.length;
                    disks[i].vhd = {
                        uri: `http://${storageAccounts[storageAccountToUse]}.blob.${buildingBlockSettings.cloud.suffixes.storageEndpoint}/vhds/${parent.name}-dataDisk${i + 1}.vhd`
                    };
                }
            } else if (disks[i].createOption === 'attach') {
                if (parent.storageAccounts.managed) {
                    // If we are managed, the name cannot be changed.
                    delete disks[i].name;
                }
            }
        }

        return {
            storageProfile: {
                dataDisks: disks
            }
        };
    },
    nics: (value, key, index, parent, parentAccumulator) => {
        let ntwkInterfaces = _.transform(parentAccumulator.networkInterfaces, (result, n) => {
            if (_.includes(n.name, parent.name)) {
                let nicRef = {
                    id: resources.resourceId(n.subscriptionId, n.resourceGroupName, 'Microsoft.Network/networkInterfaces', n.name),
                    properties: {
                        primary: n.properties.primary
                    }
                };
                result.push(nicRef);
            }
            return result;
        }, []);
        return {
            networkProfile: {
                networkInterfaces: ntwkInterfaces
            }
        };
    },
    diagnosticStorageAccounts: (value, key, index, parent, parentAccumulator, buildingBlockSettings) => {
        // get the diagonstic account name for the VM
        let diagnosticAccounts = _.cloneDeep(parent.diagnosticStorageAccounts.accounts);
        parentAccumulator.diagnosticStorageAccounts.forEach((account) => {
            diagnosticAccounts.push(account.name);
        });
        let diagnosticAccountToUse = index % diagnosticAccounts.length;
        let diagnosticAccountName = diagnosticAccounts[diagnosticAccountToUse];

        return {
            diagnosticsProfile: {
                bootDiagnostics: {
                    enabled: true,
                    storageUri: `http://${diagnosticAccountName}.blob.${buildingBlockSettings.cloud.suffixes.storageEndpoint}`
                }
            }
        };
    },
    computerNamePrefix: (value, key, index) => {
        return {
            osProfile: {
                computerName: value.concat('-vm', index + 1)
            }
        };
    },
    adminPassword: (value, key, index, parent) => {
        if (parent.osType === 'windows') {
            return {
                osProfile: {
                    adminPassword: '$SECRET$',
                    windowsConfiguration: {
                        provisionVmAgent: true
                    }
                }
            };
        } else {
            return {
                osProfile: {
                    adminPassword: '$SECRET$',
                    linuxConfiguration: null
                }
            };
        }
    },
    sshPublicKey: (value, key, index, parent) => {
        return {
            osProfile: {
                adminPassword: null,
                linuxConfiguration: {
                    disablePasswordAuthentication: true,
                    ssh: {
                        publicKeys: [
                            {
                                path: `/home/${parent.adminUsername}/.ssh/authorized_keys`,
                                keyData: '$SECRET$'
                            }
                        ]
                    }
                }
            }
        };
    },
    adminUsername: (value) => {
        return {
            osProfile: {
                adminUsername: value
            }
        };
    }
};

function processVMStamps(param) {
    // deep clone settings for the number of VMs required (vmCount)
    let vmCount = param.vmCount;
    let result = [];
    for (let i = 0; i < vmCount; i++) {
        let stamp = _.cloneDeep(param);
        stamp.name = param.namePrefix.concat('-vm', i + 1);

        // delete namePrefix property since we wont need it anymore
        delete stamp.namePrefix;
        result.push(stamp);
    }
    return result;
}

function transform(settings, buildingBlockSettings) {
    let accumulator = { publicIpAddresses: [], networkInterfaces: [] };

    // process storageAccounts
    accumulator.storageAccounts = (storageSettings.transform(settings.storageAccounts, settings)).accounts;

    // process diagnosticStorageAccounts
    accumulator.diagnosticStorageAccounts = (storageSettings.transform(settings.diagnosticStorageAccounts, settings)).accounts;

    // process availabilitySet
    if (!v.utilities.isNullOrWhitespace(settings.availabilitySet.name)) {
        _.merge(accumulator, avSetSettings.transform(settings.availabilitySet, settings));
    } else {
        accumulator.availabilitySet = [];
    }

    // process VMs
    let vms = _.transform(processVMStamps(settings), (result, vmStamp, vmIndex) => {
        // process network interfaces
        let nicResults = nicSettings.transform(vmStamp.nics, vmStamp, vmIndex);
        accumulator.networkInterfaces = _.concat(accumulator.networkInterfaces, nicResults.nics);
        accumulator.publicIpAddresses = _.concat(accumulator.publicIpAddresses, nicResults.pips);

        // process virtual machine properties
        let vmProperties = _.transform(vmStamp, (properties, value, key, parent) => {
            if (processorProperties[key]) {
                _.merge(properties, processorProperties[key](value, key, vmIndex, parent, accumulator, buildingBlockSettings));
            }

            return properties;
        }, {});

        // TODO!!!!! For now, we are going to remove osProfile if the osDisk is attach because it will fail otherwise.  Find a better way to do this!
        if (vmProperties.storageProfile.osDisk.createOption === 'attach') {
            delete vmProperties.osProfile;
        }

        // process extensions. Transform extensions in VM to shaped required by virtualMachineExtensionsSettings
        let extensionParam = [{
            vms: [vmStamp.name],
            extensions: vmStamp.extensions
        }];
        let transformedExtensions = vmExtensions.transform(extensionParam).extensions;

        result.virtualMachines.push({
            properties: vmProperties,
            name: vmStamp.name,
            extensions: transformedExtensions,
            resourceGroupName: vmStamp.resourceGroupName,
            subscriptionId: vmStamp.subscriptionId,
            location: vmStamp.location,
            tags: vmStamp.tags
        });

        return result;
    }, { virtualMachines: [] });
    accumulator.virtualMachines = vms.virtualMachines;

    // process scale set
    if (!_.isNil(settings.scaleSetSettings)) {
        let ssParam = scaleSetSettings.transform(settings.scaleSetSettings, accumulator);

        accumulator.scaleSet = ssParam.scaleSet;
        accumulator.autoScaleSettings = ssParam.autoScaleSettings;

        // For scaleset, we dont need to create nics, availabilitySet & VMs. Remove from accumulator
        accumulator.virtualMachines = [];
        accumulator.networkInterfaces = [];
        accumulator.availabilitySet = [];
    }

    // process secrets
    if (settings.osType === 'linux' && !_.isNil(settings.sshPublicKey)) {
        accumulator.secret = settings.sshPublicKey;
    } else {
        accumulator.secret = settings.adminPassword;
    }

    // process load balancer if specified
    if (settings.loadBalancerSettings) {
        let lbResults = lbSettings.transform(settings.loadBalancerSettings, buildingBlockSettings);
        accumulator.loadBalancer = lbResults.loadBalancer;
        if (lbResults.publicIpAddresses) {
            accumulator.publicIpAddresses = _.concat(accumulator.publicIpAddresses, lbResults.publicIpAddresses);
        }
    }

    return accumulator;
}

function process({ settings, buildingBlockSettings, defaultSettings }) {
    // Merge
    let mergedSettings = merge({
        settings: settings,
        buildingBlockSettings: buildingBlockSettings,
        defaultSettings: defaultSettings
    });

    // Validate
    let errors = validate(mergedSettings);

    if (errors.length > 0) {
        throw new Error(JSON.stringify(errors));
    }

    // Transform
    let results = transform(mergedSettings, buildingBlockSettings);
    let resourceGroups = resources.extractResourceGroups(
        results.availabilitySet,
        results.diagnosticStorageAccounts,
        results.loadBalancer,
        results.scaleSet,
        results.autoScaleSettings,
        results.networkInterfaces,
        results.publicIpAddresses,
        results.storageAccounts,
        results.virtualMachines);

    return {
        resourceGroups: resourceGroups,
        parameters: results
    };
}

exports.process = process;