describe('connectionSettings', () => {
    let _ = require('lodash');
    let rewire = require('rewire');
    let connectionSettings = rewire('../core/connectionSettings.js');
    let validation = require('../core/validation.js');

    describe('isValidConnectionType', () => {
        let isValidConnectionType = connectionSettings.__get__('isValidConnectionType');
        it('undefined', () => {
            expect(isValidConnectionType()).toEqual(false);
        });

        it('null', () => {
            expect(isValidConnectionType(null)).toEqual(false);
        });

        it('empty', () => {
            expect(isValidConnectionType('')).toEqual(false);
        });

        it('whitespace', () => {
            expect(isValidConnectionType(' ')).toEqual(false);
        });

        it('invalid spacing', () => {
            expect(isValidConnectionType(' IPsec ')).toEqual(false);
        });

        it('invalid casing', () => {
            expect(isValidConnectionType('ipsec')).toEqual(false);
        });

        it('invalid value', () => {
            expect(isValidConnectionType('NOT_A_VALID_CONNECTION_TYPE')).toEqual(false);
        });

        it('IPsec', () => {
            expect(isValidConnectionType('IPsec')).toEqual(true);
        });

        it('Vnet2Vnet', () => {
            expect(isValidConnectionType('Vnet2Vnet')).toEqual(true);
        });

        it('ExpressRoute', () => {
            expect(isValidConnectionType('ExpressRoute')).toEqual(true);
        });
    });

    describe('merge', () => {
        let connectionSettingsDefaults = connectionSettings.__get__('connectionSettingsDefaults');
        it('valid', () => {
            let result = validation.merge({}, connectionSettingsDefaults);
            expect(result).toEqual({});
        });
    });

    describe('validations', () => {
        let connectionSettingsValidations = connectionSettings.__get__('connectionSettingsValidations');
        let fullConnectionSettings = {
            name: 'my-connection',
            routingWeight: 10,
            sharedKey: 'mysecret',
            virtualNetworkGateway: {
                name: 'vgw'
            },
            virtualNetworkGateway1: {
                name: 'vgw1'
            },
            virtualNetworkGateway2: {
                name: 'vgw2'
            },
            expressRouteCircuit: {
                name: 'my-er-circuit'
            },
            localNetworkGateway: {
                name: 'my-lgw',
                ipAddress: '40.50.60.70',
                addressPrefixes: ['10.0.1.0/24']
            }
        };

        let ipsecConnectionSettings = {
            name: fullConnectionSettings.name,
            routingWeight: fullConnectionSettings.routingWeight,
            connectionType: 'IPsec',
            sharedKey: fullConnectionSettings.sharedKey,
            virtualNetworkGateway: fullConnectionSettings.virtualNetworkGateway,
            localNetworkGateway: fullConnectionSettings.localNetworkGateway
        };

        let expressRouteConnectionSettings = {
            name: fullConnectionSettings.name,
            routingWeight: fullConnectionSettings.routingWeight,
            connectionType: 'ExpressRoute',
            virtualNetworkGateway: fullConnectionSettings.virtualNetworkGateway,
            expressRouteCircuit: fullConnectionSettings.expressRouteCircuit
        };

        let vnet2VnetConnectionSettings = {
            name: fullConnectionSettings.name,
            routingWeight: fullConnectionSettings.routingWeight,
            connectionType: 'Vnet2Vnet',
            sharedKey: fullConnectionSettings.sharedKey,
            virtualNetworkGateway1: fullConnectionSettings.virtualNetworkGateway1,
            virtualNetworkGateway2: fullConnectionSettings.virtualNetworkGateway2
        };

        let v = (settings, field) => {
            let clone = _.cloneDeep(settings);
            delete clone[field];
            return validation.validate({
                settings: clone,
                validations: connectionSettingsValidations
            });
        };

        describe('IPsec', () => {
            let connectionSettings = ipsecConnectionSettings;
            it('name undefined', () => {
                let errors = v(connectionSettings, 'name');
                expect(errors.length).toEqual(1);
                expect(errors[0].name).toEqual('.name');
            });

            it('routingWeight undefined', () => {
                let errors = v(connectionSettings, 'routingWeight');
                expect(errors.length).toEqual(1);
                expect(errors[0].name).toEqual('.routingWeight');
            });

            it('connectionType undefined', () => {
                let errors = v(connectionSettings, 'connectionType');
                expect(errors.length).toEqual(1);
                expect(errors[0].name).toEqual('.connectionType');
            });

            it('sharedKey undefined', () => {
                let errors = v(connectionSettings, 'sharedKey');
                expect(errors.length).toEqual(1);
                expect(errors[0].name).toEqual('.sharedKey');
            });

            it('sharedKey null', () => {
                let settings = _.cloneDeep(connectionSettings);
                settings.sharedKey = null;
                let errors = validation.validate({
                    settings: settings,
                    validations: connectionSettingsValidations
                });
                
                expect(errors.length).toEqual(1);
                expect(errors[0].name).toEqual('.sharedKey');
            });

            it('sharedKey empty', () => {
                let settings = _.cloneDeep(connectionSettings);
                settings.sharedKey = '';
                let errors = validation.validate({
                    settings: settings,
                    validations: connectionSettingsValidations
                });
                
                expect(errors.length).toEqual(1);
                expect(errors[0].name).toEqual('.sharedKey');
            });

            it('sharedKey whitespace', () => {
                let settings = _.cloneDeep(connectionSettings);
                settings.sharedKey = '   ';
                let errors = validation.validate({
                    settings: settings,
                    validations: connectionSettingsValidations
                });
                
                expect(errors.length).toEqual(1);
                expect(errors[0].name).toEqual('.sharedKey');
            });

            it('virtualNetworkGateway undefined', () => {
                let errors = v(connectionSettings, 'virtualNetworkGateway');
                expect(errors.length).toEqual(1);
                expect(errors[0].name).toEqual('.virtualNetworkGateway');
            });

            it('localNetworkGateway undefined', () => {
                let errors = v(connectionSettings, 'localNetworkGateway');
                expect(errors.length).toEqual(1);
                expect(errors[0].name).toEqual('.localNetworkGateway');
            });

            it('expressRouteCircuit defined', () => {
                let settings = _.cloneDeep(connectionSettings);
                settings.expressRouteCircuit = fullConnectionSettings.expressRouteCircuit;
                let errors = validation.validate({
                    settings: settings,
                    validations: connectionSettingsValidations
                });
                
                expect(errors.length).toEqual(1);
                expect(errors[0].name).toEqual('.expressRouteCircuit');
            });

            it('virtualNetworkGateway1 defined', () => {
                let settings = _.cloneDeep(connectionSettings);
                settings.virtualNetworkGateway1 = fullConnectionSettings.virtualNetworkGateway1;
                let errors = validation.validate({
                    settings: settings,
                    validations: connectionSettingsValidations
                });
                
                expect(errors.length).toEqual(1);
                expect(errors[0].name).toEqual('.virtualNetworkGateway1');
            });

            it('virtualNetworkGateway2 defined', () => {
                let settings = _.cloneDeep(connectionSettings);
                settings.virtualNetworkGateway2 = fullConnectionSettings.virtualNetworkGateway2;
                let errors = validation.validate({
                    settings: settings,
                    validations: connectionSettingsValidations
                });
                
                expect(errors.length).toEqual(1);
                expect(errors[0].name).toEqual('.virtualNetworkGateway2');
            });

            it('valid', () => {
                let errors = validation.validate({
                    settings: connectionSettings,
                    validations: connectionSettingsValidations
                });

                expect(errors.length).toEqual(0);
            });
        });

        describe('ExpressRoute', () => {
            let connectionSettings = expressRouteConnectionSettings;
            it('name undefined', () => {
                let errors = v(connectionSettings, 'name');
                expect(errors.length).toEqual(1);
                expect(errors[0].name).toEqual('.name');
            });

            it('routingWeight undefined', () => {
                let errors = v(connectionSettings, 'routingWeight');
                expect(errors.length).toEqual(1);
                expect(errors[0].name).toEqual('.routingWeight');
            });

            it('connectionType undefined', () => {
                let errors = v(connectionSettings, 'connectionType');
                expect(errors.length).toEqual(1);
                expect(errors[0].name).toEqual('.connectionType');
            });

            it('sharedKey defined', () => {
                let settings = _.cloneDeep(connectionSettings);
                settings.sharedKey = fullConnectionSettings.sharedKey;
                let errors = validation.validate({
                    settings: settings,
                    validations: connectionSettingsValidations
                });
                expect(errors.length).toEqual(1);
                expect(errors[0].name).toEqual('.sharedKey');
            });

            it('virtualNetworkGateway undefined', () => {
                let errors = v(connectionSettings, 'virtualNetworkGateway');
                expect(errors.length).toEqual(1);
                expect(errors[0].name).toEqual('.virtualNetworkGateway');
            });

            it('expressRouteCircuit undefined', () => {
                let errors = v(connectionSettings, 'expressRouteCircuit');
                expect(errors.length).toEqual(1);
                expect(errors[0].name).toEqual('.expressRouteCircuit');
            });

            it('localNetworkGateway defined', () => {
                let settings = _.cloneDeep(connectionSettings);
                settings.localNetworkGateway = fullConnectionSettings.localNetworkGateway;
                let errors = validation.validate({
                    settings: settings,
                    validations: connectionSettingsValidations
                });
                
                expect(errors.length).toEqual(1);
                expect(errors[0].name).toEqual('.localNetworkGateway');
            });

            it('virtualNetworkGateway1 defined', () => {
                let settings = _.cloneDeep(connectionSettings);
                settings.virtualNetworkGateway1 = fullConnectionSettings.virtualNetworkGateway1;
                let errors = validation.validate({
                    settings: settings,
                    validations: connectionSettingsValidations
                });
                
                expect(errors.length).toEqual(1);
                expect(errors[0].name).toEqual('.virtualNetworkGateway1');
            });

            it('virtualNetworkGateway2 defined', () => {
                let settings = _.cloneDeep(connectionSettings);
                settings.virtualNetworkGateway2 = fullConnectionSettings.virtualNetworkGateway2;
                let errors = validation.validate({
                    settings: settings,
                    validations: connectionSettingsValidations
                });
                
                expect(errors.length).toEqual(1);
                expect(errors[0].name).toEqual('.virtualNetworkGateway2');
            });

            it('valid', () => {
                let errors = validation.validate({
                    settings: connectionSettings,
                    validations: connectionSettingsValidations
                });

                expect(errors.length).toEqual(0);
            });
        });

        describe('Vnet2Vnet', () => {
            let connectionSettings = vnet2VnetConnectionSettings;
            it('name undefined', () => {
                let errors = v(connectionSettings, 'name');
                expect(errors.length).toEqual(1);
                expect(errors[0].name).toEqual('.name');
            });

            it('routingWeight undefined', () => {
                let errors = v(connectionSettings, 'routingWeight');
                expect(errors.length).toEqual(1);
                expect(errors[0].name).toEqual('.routingWeight');
            });

            it('connectionType undefined', () => {
                let errors = v(connectionSettings, 'connectionType');
                expect(errors.length).toEqual(1);
                expect(errors[0].name).toEqual('.connectionType');
            });

            it('sharedKey undefined', () => {
                let errors = v(connectionSettings, 'sharedKey');
                expect(errors.length).toEqual(1);
                expect(errors[0].name).toEqual('.sharedKey');
            });

            it('sharedKey null', () => {
                let settings = _.cloneDeep(connectionSettings);
                settings.sharedKey = null;
                let errors = validation.validate({
                    settings: settings,
                    validations: connectionSettingsValidations
                });
                
                expect(errors.length).toEqual(1);
                expect(errors[0].name).toEqual('.sharedKey');
            });

            it('sharedKey empty', () => {
                let settings = _.cloneDeep(connectionSettings);
                settings.sharedKey = '';
                let errors = validation.validate({
                    settings: settings,
                    validations: connectionSettingsValidations
                });
                
                expect(errors.length).toEqual(1);
                expect(errors[0].name).toEqual('.sharedKey');
            });

            it('sharedKey whitespace', () => {
                let settings = _.cloneDeep(connectionSettings);
                settings.sharedKey = '   ';
                let errors = validation.validate({
                    settings: settings,
                    validations: connectionSettingsValidations
                });
                
                expect(errors.length).toEqual(1);
                expect(errors[0].name).toEqual('.sharedKey');
            });

            it('virtualNetworkGateway1 undefined', () => {
                let errors = v(connectionSettings, 'virtualNetworkGateway1');
                expect(errors.length).toEqual(1);
                expect(errors[0].name).toEqual('.virtualNetworkGateway1');
            });

            it('virtualNetworkGateway2 undefined', () => {
                let errors = v(connectionSettings, 'virtualNetworkGateway2');
                expect(errors.length).toEqual(1);
                expect(errors[0].name).toEqual('.virtualNetworkGateway2');
            });

            it('localNetworkGateway defined', () => {
                let settings = _.cloneDeep(connectionSettings);
                settings.localNetworkGateway = fullConnectionSettings.localNetworkGateway;
                let errors = validation.validate({
                    settings: settings,
                    validations: connectionSettingsValidations
                });
                
                expect(errors.length).toEqual(1);
                expect(errors[0].name).toEqual('.localNetworkGateway');
            });

            it('virtualNetworkGateway defined', () => {
                let settings = _.cloneDeep(connectionSettings);
                settings.virtualNetworkGateway = fullConnectionSettings.virtualNetworkGateway;
                let errors = validation.validate({
                    settings: settings,
                    validations: connectionSettingsValidations
                });
                
                expect(errors.length).toEqual(1);
                expect(errors[0].name).toEqual('.virtualNetworkGateway');
            });

            it('expressRouteCircuit defined', () => {
                let settings = _.cloneDeep(connectionSettings);
                settings.expressRouteCircuit = fullConnectionSettings.expressRouteCircuit;
                let errors = validation.validate({
                    settings: settings,
                    validations: connectionSettingsValidations
                });
                
                expect(errors.length).toEqual(1);
                expect(errors[0].name).toEqual('.expressRouteCircuit');
            });

            it('valid', () => {
                let errors = validation.validate({
                    settings: connectionSettings,
                    validations: connectionSettingsValidations
                });

                expect(errors.length).toEqual(0);
            });
        });
    });

    describe('transform', () => {
        let fullConnectionSettings = {
            name: 'my-connection',
            routingWeight: 10,
            sharedKey: 'mysecret',
            virtualNetworkGateway: {
                name: 'vgw'
            },
            virtualNetworkGateway1: {
                name: 'vgw1'
            },
            virtualNetworkGateway2: {
                name: 'vgw2'
            },
            expressRouteCircuit: {
                name: 'my-er-circuit'
            },
            localNetworkGateway: {
                name: 'my-lgw',
                ipAddress: '40.50.60.70',
                addressPrefixes: ['10.0.1.0/24']
            }
        };

        let ipsecConnectionSettings = {
            name: fullConnectionSettings.name,
            routingWeight: fullConnectionSettings.routingWeight,
            connectionType: 'IPsec',
            sharedKey: fullConnectionSettings.sharedKey,
            virtualNetworkGateway: fullConnectionSettings.virtualNetworkGateway,
            localNetworkGateway: fullConnectionSettings.localNetworkGateway
        };

        let expressRouteConnectionSettings = {
            name: fullConnectionSettings.name,
            routingWeight: fullConnectionSettings.routingWeight,
            connectionType: 'ExpressRoute',
            virtualNetworkGateway: fullConnectionSettings.virtualNetworkGateway,
            expressRouteCircuit: fullConnectionSettings.expressRouteCircuit
        };

        let vnet2VnetConnectionSettings = {
            name: fullConnectionSettings.name,
            routingWeight: fullConnectionSettings.routingWeight,
            connectionType: 'Vnet2Vnet',
            sharedKey: fullConnectionSettings.sharedKey,
            virtualNetworkGateway1: fullConnectionSettings.virtualNetworkGateway1,
            virtualNetworkGateway2: fullConnectionSettings.virtualNetworkGateway2
        };

        let buildingBlockSettings = {
            subscriptionId: '00000000-0000-1000-8000-000000000000',
            resourceGroupName: 'test-vnet-rg'
        };

        it('IPsec settings', () => {
            let settings = _.cloneDeep(ipsecConnectionSettings);
            let result = connectionSettings.transform({
                settings: settings,
                buildingBlockSettings: buildingBlockSettings
            });
            expect(result.connections.length).toEqual(1);
            expect(result.localNetworkGateways.length).toEqual(1);
            let connectionSetting = result.connections[0];
            expect(connectionSetting.name).toBe(settings.name);
            expect(connectionSetting.properties.connectionType).toBe(settings.connectionType);
            expect(connectionSetting.properties.routingWeight).toBe(settings.routingWeight);
            expect(connectionSetting.properties.sharedKey).toBe(settings.sharedKey);
            expect(_.endsWith(connectionSetting.properties.virtualNetworkGateway1.id, `/virtualNetworkGateways/${fullConnectionSettings.virtualNetworkGateway.name}`)).toBe(true);
            expect(_.endsWith(connectionSetting.properties.localNetworkGateway2.id, `/localNetworkGateways/${fullConnectionSettings.localNetworkGateway.name}`)).toBe(true);
            let localNetworkGateway = result.localNetworkGateways[0];
            expect(localNetworkGateway.name).toEqual(settings.localNetworkGateway.name);
            expect(localNetworkGateway.properties.gatewayIpAddress).toEqual(settings.localNetworkGateway.ipAddress);
            expect(localNetworkGateway.properties.localNetworkAddressSpace.addressPrefixes.length).toEqual(1);
            expect(localNetworkGateway.properties.localNetworkAddressSpace.addressPrefixes[0]).toEqual(settings.localNetworkGateway.addressPrefixes[0]);
        });

        it('ExpressRoute settings', () => {
            let settings = _.cloneDeep(expressRouteConnectionSettings);
            let result = connectionSettings.transform({
                settings: settings,
                buildingBlockSettings: buildingBlockSettings
            });
            expect(result.connections.length).toBe(1);
            expect(result.localNetworkGateways.length).toEqual(0);
            let connectionSetting = result.connections[0];
            expect(connectionSetting.name).toBe(settings.name);
            expect(connectionSetting.properties.connectionType).toBe(settings.connectionType);
            expect(connectionSetting.properties.routingWeight).toBe(settings.routingWeight);
            expect(connectionSetting.properties.sharedKey).toBeUndefined();
            expect(_.endsWith(connectionSetting.properties.virtualNetworkGateway1.id, `/virtualNetworkGateways/${fullConnectionSettings.virtualNetworkGateway.name}`)).toBe(true);
            expect(_.endsWith(connectionSetting.properties.peer.id, `/expressRouteCircuits/${fullConnectionSettings.expressRouteCircuit.name}`)).toBe(true);
        });

        it('Vnet2Vnet settings', () => {
            let settings = _.cloneDeep(vnet2VnetConnectionSettings);
            let result = connectionSettings.transform({
                settings: settings,
                buildingBlockSettings: buildingBlockSettings
            });
            expect(result.connections.length).toBe(1);
            expect(result.localNetworkGateways.length).toEqual(0);
            let connectionSetting = result.connections[0];
            expect(connectionSetting.name).toBe(settings.name);
            expect(connectionSetting.properties.connectionType).toBe(settings.connectionType);
            expect(connectionSetting.properties.routingWeight).toBe(settings.routingWeight);
            expect(connectionSetting.properties.sharedKey).toBe(settings.sharedKey);
            expect(_.endsWith(connectionSetting.properties.virtualNetworkGateway1.id, `/virtualNetworkGateways/${fullConnectionSettings.virtualNetworkGateway1.name}`)).toBe(true);
            expect(_.endsWith(connectionSetting.properties.virtualNetworkGateway2.id, `/virtualNetworkGateways/${fullConnectionSettings.virtualNetworkGateway2.name}`)).toBe(true);
        });

        it('IPsec and ExpressRoute settings', () => {
            let settings = [_.cloneDeep(ipsecConnectionSettings), _.cloneDeep(expressRouteConnectionSettings)];
            let result = connectionSettings.transform({
                settings: settings,
                buildingBlockSettings: buildingBlockSettings
            });
            expect(result.connections.length).toBe(2);
            expect(result.localNetworkGateways.length).toEqual(1);
            let connectionSetting = result.connections[0];
            let setting = settings[0];
            expect(connectionSetting.name).toBe(setting.name);
            expect(connectionSetting.properties.connectionType).toBe(setting.connectionType);
            expect(connectionSetting.properties.routingWeight).toBe(setting.routingWeight);
            expect(connectionSetting.properties.sharedKey).toBe(setting.sharedKey);
            expect(_.endsWith(connectionSetting.properties.virtualNetworkGateway1.id, `/virtualNetworkGateways/${fullConnectionSettings.virtualNetworkGateway.name}`)).toBe(true);
            expect(_.endsWith(connectionSetting.properties.localNetworkGateway2.id, `/localNetworkGateways/${fullConnectionSettings.localNetworkGateway.name}`)).toBe(true);

            connectionSetting = result.connections[1];
            setting = settings[1];
            expect(connectionSetting.name).toBe(setting.name);
            expect(connectionSetting.properties.connectionType).toBe(setting.connectionType);
            expect(connectionSetting.properties.routingWeight).toBe(setting.routingWeight);
            expect(connectionSetting.properties.sharedKey).toBeUndefined();
            expect(_.endsWith(connectionSetting.properties.virtualNetworkGateway1.id, `/virtualNetworkGateways/${fullConnectionSettings.virtualNetworkGateway.name}`)).toBe(true);
            expect(_.endsWith(connectionSetting.properties.peer.id, `/expressRouteCircuits/${fullConnectionSettings.expressRouteCircuit.name}`)).toBe(true);
        });

        it('test settings validation errors', () => {
            let settings = _.cloneDeep(ipsecConnectionSettings);
            delete settings.name;
            expect(() => {
                connectionSettings.transform({
                    settings: settings,
                    buildingBlockSettings: buildingBlockSettings
                });
            }).toThrow();
        });

        it('test building blocks validation errors', () => {
            let settings = _.cloneDeep(ipsecConnectionSettings);
            let bbSettings = _.cloneDeep(buildingBlockSettings);
            delete bbSettings.subscriptionId;
            expect(() => {
                connectionSettings.transform({
                    settings: settings,
                    buildingBlockSettings: bbSettings
                });
            }).toThrow();
        });
    });
});