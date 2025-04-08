import { ReadPermissionVal } from '@fastgpt/global/support/permission/constant';
import { MongoDatasetTraining } from '@fastgpt/service/core/dataset/training/schema';
import { authDatasetCollection } from '@fastgpt/service/support/permission/dataset/auth';
import { NextAPI } from '@/service/middleware/entry';
import { ApiRequestProps } from '@fastgpt/service/type/next';

export type getTrainingDataDetailQuery = {};

export type getTrainingDataDetailBody = {
  datasetId: string;
  collectionId: string;
  dataId: string;
};

export type getTrainingDataDetailResponse =
  | {
      _id: string;
      datasetId: string;
      mode: string;
      q: string;
      a: string;
    }
  | undefined;

async function handler(
  req: ApiRequestProps<getTrainingDataDetailBody, getTrainingDataDetailQuery>
): Promise<getTrainingDataDetailResponse> {
  const { datasetId, collectionId, dataId } = req.body;

  const { teamId } = await authDatasetCollection({
    req,
    authToken: true,
    collectionId,
    per: ReadPermissionVal
  });

  const data = await MongoDatasetTraining.findOne({ teamId, datasetId, _id: dataId }).lean();

  if (!data) {
    return undefined;
  }

  return {
    _id: data._id,
    datasetId: data.datasetId,
    mode: data.mode,
    q: data.q,
    a: data.a
  };
}

export default NextAPI(handler);
