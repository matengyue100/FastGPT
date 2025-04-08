import { WritePermissionVal } from '@fastgpt/global/support/permission/constant';
import { MongoDatasetTraining } from '@fastgpt/service/core/dataset/training/schema';
import { authDatasetCollection } from '@fastgpt/service/support/permission/dataset/auth';
import { NextAPI } from '@/service/middleware/entry';
import { ApiRequestProps } from '@fastgpt/service/type/next';
import { addMinutes } from 'date-fns';

export type updateTrainingDataBody = {
  datasetId: string;
  collectionId: string;
  dataId: string;
  q?: string;
  a?: string;
  chunkIndex?: number;
};

export type updateTrainingDataQuery = {};

export type updateTrainingDataResponse = {};

async function handler(
  req: ApiRequestProps<updateTrainingDataBody, updateTrainingDataQuery>
): Promise<updateTrainingDataResponse> {
  const { datasetId, collectionId, dataId, q, a, chunkIndex } = req.body;

  const { teamId } = await authDatasetCollection({
    req,
    authToken: true,
    authApiKey: true,
    collectionId,
    per: WritePermissionVal
  });

  const data = await MongoDatasetTraining.findOne({ teamId, datasetId, _id: dataId });

  if (!data) {
    return Promise.reject('data not found');
  }

  await MongoDatasetTraining.updateOne(
    {
      teamId,
      datasetId,
      _id: dataId
    },
    {
      $unset: { errorMsg: '' },
      retryCount: 3,
      ...(q !== undefined && { q }),
      ...(a !== undefined && { a }),
      ...(chunkIndex !== undefined && { chunkIndex }),
      lockTime: addMinutes(new Date(), -10)
    }
  );

  return {};
}

export default NextAPI(handler);
