// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
import { convertAxeToSarif, SarifLog } from 'axe-sarif-converter';
import { GuidGenerator } from 'common';
import { inject, injectable } from 'inversify';
import { isNil } from 'lodash';
import { Logger } from 'logger';
import { Browser } from 'puppeteer';
import { AxeScanResults } from 'scanner';
import { OnDemandPageScanRunResultProvider, PageScanRunReportService } from 'service-library';
import {
    OnDemandPageScanReport,
    OnDemandPageScanResult,
    OnDemandPageScanRunResult,
    OnDemandPageScanRunState,
    OnDemandScanResult,
    ScanState,
} from 'storage-documents';
import { ScanMetadataConfig } from '../scan-metadata-config';
import { ScannerTask } from '../tasks/scanner-task';
import { WebDriverTask } from '../tasks/web-driver-task';

@injectable()
export class Runner {
    constructor(
        @inject(GuidGenerator) private readonly guidGenerator: GuidGenerator,
        @inject(ScanMetadataConfig) private readonly scanMetadataConfig: ScanMetadataConfig,
        @inject(ScannerTask) private readonly scannerTask: ScannerTask,
        @inject(OnDemandPageScanRunResultProvider) private readonly onDemandPageScanRunResultProvider: OnDemandPageScanRunResultProvider,
        @inject(WebDriverTask) private readonly webDriverTask: WebDriverTask,
        @inject(Logger) private readonly logger: Logger,
        @inject(PageScanRunReportService) private readonly pageScanRunReportService: PageScanRunReportService,
        private readonly convertAxeToSarifFn = convertAxeToSarif,
    ) {}

    public async run(): Promise<void> {
        let browser: Browser;
        const scanMetadata = this.scanMetadataConfig.getConfig();
        let pageScanResult: OnDemandPageScanResult;

        this.logger.logInfo(`Reading Page Scan Run id= ${scanMetadata.id}`);
        pageScanResult = (await this.onDemandPageScanRunResultProvider.readScanRuns([scanMetadata.id]))[0];

        // set scanned page run state to running
        pageScanResult.run = this.getRunResult('running');

        this.logger.logInfo(`Updating page scan to running`);
        await this.onDemandPageScanRunResultProvider.updateScanRun(pageScanResult);
        pageScanResult = (await this.onDemandPageScanRunResultProvider.readScanRuns([scanMetadata.id]))[0];

        try {
            // start new web driver process
            browser = await this.webDriverTask.launch();

            await this.scan(pageScanResult);
        } catch (error) {
            this.logger.logInfo(`Scan failed ${error}`);
            pageScanResult.run = this.getRunResult('failed', error instanceof Error ? error.message : `${error}`);
            pageScanResult.scanResult = { state: 'unknown', issueCount: 0 };
            pageScanResult.reports = [];
        } finally {
            try {
                await this.webDriverTask.close();
            } catch (error) {
                this.logger.logError(`unable to close web driver ${error}`);
            }
        }

        this.logger.logInfo(`Updating page scan in database`);
        await this.onDemandPageScanRunResultProvider.updateScanRun(pageScanResult);
    }

    private async scan(pageScanResult: OnDemandPageScanResult): Promise<void> {
        this.logger.logInfo(`Running Scan`);

        const axeScanResults = await this.scannerTask.scan(pageScanResult.url);

        if (!isNil(axeScanResults.error)) {
            this.logger.logInfo(`Changing page status to failed`);
            pageScanResult.run = this.getRunResult('failed', axeScanResults.error);
            pageScanResult.scanResult = { state: 'unknown', issueCount: 0 };
            pageScanResult.reports = [];
        } else {
            this.logger.logInfo(`Changing page status to completed`);
            pageScanResult.run = this.getRunResult('completed');
            pageScanResult.scanResult = this.getScanStatus(axeScanResults);
            pageScanResult.reports = [await this.saveScanReport(axeScanResults)];
        }
    }

    private getRunResult(state: OnDemandPageScanRunState, error?: string): OnDemandPageScanRunResult {
        return {
            state: state,
            timestamp: new Date().toJSON(),
            error,
        };
    }

    private getScanStatus(axeResults: AxeScanResults): OnDemandScanResult {
        let issueCount = 0;
        let state: ScanState = 'fail';

        if (axeResults.results.violations !== undefined && axeResults.results.violations.length > 0) {
            issueCount = axeResults.results.violations.length;
            state = 'fail';
        } else {
            state = 'pass';
            issueCount = 0;
        }

        return {
            state,
            issueCount,
        };
    }

    private async saveScanReport(axeResults: AxeScanResults): Promise<OnDemandPageScanReport> {
        const reportId = this.guidGenerator.createGuid();
        let href: string;
        const format = 'sarif';

        this.logger.logInfo(`Converting to Sarif...`);
        const sarifResults: SarifLog = this.convertAxeToSarifFn(axeResults.results);

        this.logger.logInfo(`Saving sarif results to Blobs...`);
        await this.pageScanRunReportService.saveSarifReport(reportId, JSON.stringify(sarifResults));

        this.logger.logInfo(`File saved at ${href}`);

        href = this.pageScanRunReportService.getBlobFilePath(reportId, format);

        return {
            format,
            href,
            reportId,
        };
    }
}
