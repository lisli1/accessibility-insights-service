// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

import { CosmosContainerClient, cosmosContainerClientTypes, CosmosOperationResponse } from 'azure-services';
import { inject, injectable } from 'inversify';
import { ItemType, OnDemandPageScanRequest, PartitionKey } from 'storage-documents';

@injectable()
export class PageScanRequestProvider {
    constructor(
        @inject(cosmosContainerClientTypes.OnDemandScanRequestsCosmosContainerClient)
        private readonly cosmosContainerClient: CosmosContainerClient,
    ) {}

    public async getRequests(
        continuationToken?: string,
        itemsCount: number = 100,
    ): Promise<CosmosOperationResponse<OnDemandPageScanRequest[]>> {
        const query = {
            query:
                'SELECT TOP @itemsCount * FROM c WHERE c.partitionKey = @partitionKey and c.itemType = @itemType ORDER BY c.priority DESC',
            parameters: [
                {
                    name: '@itemsCount',
                    value: itemsCount,
                },
                {
                    name: '@partitionKey',
                    value: PartitionKey.pageScanRequestDocuments,
                },
                {
                    name: '@itemType',
                    value: ItemType.onDemandPageScanRequest,
                },
            ],
        };

        return this.cosmosContainerClient.queryDocuments<OnDemandPageScanRequest>(query, continuationToken);
    }

    public async insertRequests(requests: OnDemandPageScanRequest[]): Promise<void> {
        return this.cosmosContainerClient.writeDocuments(requests, PartitionKey.pageScanRequestDocuments);
    }

    public async deleteRequests(ids: string[]): Promise<void> {
        await Promise.all(
            ids.map(async (id) => {
                await this.cosmosContainerClient.deleteDocument(id, PartitionKey.pageScanRequestDocuments);
            }),
        );
    }
}
