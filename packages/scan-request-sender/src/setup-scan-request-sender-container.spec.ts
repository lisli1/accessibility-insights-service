import 'reflect-metadata';

import { StorageClient } from 'axis-storage';
import { ScanRequestSender } from './sender/request-sender';
import { setupScanRequestSenderContainer } from './setup-scan-request-sender-container';
import { SeedSource } from './source/seed-source';
// tslint:disable: no-any

describe(setupScanRequestSenderContainer, () => {
    beforeEach(() => {
        process.env.AZURE_STORAGE_SCAN_QUEUE = 'test-scan-queue';
    });

    it('verify StorageClient resolution', () => {
        const container = setupScanRequestSenderContainer();

        const storageClient = container.get(StorageClient);

        expect((storageClient as any).dbName).toBe('scanner');
        expect((storageClient as any).collectionName).toBe('webPagesToScan');
    });

    it('verify scan request sender dependencies resolution', () => {
        const container = setupScanRequestSenderContainer();

        expect(container.get(SeedSource)).toBeDefined();
        expect(container.get(ScanRequestSender)).toBeDefined();
    });
});