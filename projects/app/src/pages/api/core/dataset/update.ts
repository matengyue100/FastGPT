import { MongoDataset } from '@fastgpt/service/core/dataset/schema';
import type { DatasetUpdateBody } from '@fastgpt/global/core/dataset/api.d';
import { authDataset } from '@fastgpt/service/support/permission/dataset/auth';
import { NextAPI } from '@/service/middleware/entry';
import {
  ManagePermissionVal,
  PerResourceTypeEnum,
  ReadPermissionVal
} from '@fastgpt/global/support/permission/constant';
import { CommonErrEnum } from '@fastgpt/global/common/error/code/common';
import type { ApiRequestProps, ApiResponseType } from '@fastgpt/service/type/next';
import {
  DatasetCollectionTypeEnum,
  DatasetTypeEnum,
  TrainingModeEnum
} from '@fastgpt/global/core/dataset/constants';
import { ClientSession } from 'mongoose';
import { parseParentIdInMongo } from '@fastgpt/global/common/parentFolder/utils';
import { mongoSessionRun } from '@fastgpt/service/common/mongo/sessionRun';
import { getResourceClbsAndGroups } from '@fastgpt/service/support/permission/controller';
import {
  syncChildrenPermission,
  syncCollaborators
} from '@fastgpt/service/support/permission/inheritPermission';
import { authUserPer } from '@fastgpt/service/support/permission/user/auth';
import { TeamDatasetCreatePermissionVal } from '@fastgpt/global/support/permission/user/constant';
import { DatasetErrEnum } from '@fastgpt/global/common/error/code/dataset';
import { MongoDatasetTraining } from '@fastgpt/service/core/dataset/training/schema';
import { MongoDatasetCollection } from '@fastgpt/service/core/dataset/collection/schema';
import { addDays } from 'date-fns';
import { refreshSourceAvatar } from '@fastgpt/service/common/file/image/controller';
import { MongoResourcePermission } from '@fastgpt/service/support/permission/schema';
import { DatasetSchemaType } from '@fastgpt/global/core/dataset/type';
import {
  removeWebsiteSyncJobScheduler,
  upsertWebsiteSyncJobScheduler
} from '@fastgpt/service/core/dataset/websiteSync';
import { delDatasetRelevantData } from '@fastgpt/service/core/dataset/controller';
import { isEqual } from 'lodash';

export type DatasetUpdateQuery = {};
export type DatasetUpdateResponse = any;

// 更新知识库接口
// 包括如下功能：
// 1. 更新应用的信息（包括名称，类型，头像，介绍等）
// 2. 更新数据库的配置信息
// 3. 移动知识库
// 操作权限：
// 1. 更新信息和配置编排需要有知识库的写权限
// 2. 移动应用需要有
//  (1) 父目录的管理权限
//  (2) 目标目录的管理权限
//  (3) 如果从根目录移动或移动到根目录，需要有团队的应用创建权限
async function handler(
  req: ApiRequestProps<DatasetUpdateBody, DatasetUpdateQuery>,
  _res: ApiResponseType<any>
): Promise<DatasetUpdateResponse> {
  const {
    id,
    parentId,
    name,
    avatar,
    intro,
    agentModel,
    vlmModel,
    websiteConfig,
    externalReadUrl,
    apiServer,
    yuqueServer,
    feishuServer,
    autoSync,
    chunkSettings
  } = req.body;

  if (!id) {
    return Promise.reject(CommonErrEnum.missingParams);
  }

  const isMove = parentId !== undefined;

  const { dataset, permission } = await authDataset({
    req,
    authToken: true,
    datasetId: id,
    per: ReadPermissionVal
  });
  if (isMove) {
    if (parentId) {
      // move to a folder, check the target folder's permission
      await authDataset({ req, authToken: true, datasetId: parentId, per: ManagePermissionVal });
    }
    if (dataset.parentId) {
      // move from a folder, check the (old) folder's permission
      await authDataset({
        req,
        authToken: true,
        datasetId: dataset.parentId,
        per: ManagePermissionVal
      });
    }
    if (parentId === null || !dataset.parentId) {
      // move to root or move from root
      await authUserPer({
        req,
        authToken: true,
        per: TeamDatasetCreatePermissionVal
      });
    }
  } else {
    // is not move
    if (!permission.hasWritePer) return Promise.reject(DatasetErrEnum.unAuthDataset);
  }

  const isFolder = dataset.type === DatasetTypeEnum.folder;

  updateTraining({
    teamId: dataset.teamId,
    datasetId: id,
    agentModel
  });

  const onUpdate = async (session: ClientSession) => {
    // Website dataset update chunkSettings, need to clean up dataset
    if (
      dataset.type === DatasetTypeEnum.websiteDataset &&
      chunkSettings &&
      dataset.chunkSettings &&
      !isEqual(
        {
          imageIndex: dataset.chunkSettings.imageIndex,
          autoIndexes: dataset.chunkSettings.autoIndexes,
          trainingType: dataset.chunkSettings.trainingType,
          chunkSettingMode: dataset.chunkSettings.chunkSettingMode,
          chunkSplitMode: dataset.chunkSettings.chunkSplitMode,
          chunkSize: dataset.chunkSettings.chunkSize,
          chunkSplitter: dataset.chunkSettings.chunkSplitter,
          indexSize: dataset.chunkSettings.indexSize,
          qaPrompt: dataset.chunkSettings.qaPrompt
        },
        {
          imageIndex: chunkSettings.imageIndex,
          autoIndexes: chunkSettings.autoIndexes,
          trainingType: chunkSettings.trainingType,
          chunkSettingMode: chunkSettings.chunkSettingMode,
          chunkSplitMode: chunkSettings.chunkSplitMode,
          chunkSize: chunkSettings.chunkSize,
          chunkSplitter: chunkSettings.chunkSplitter,
          indexSize: chunkSettings.indexSize,
          qaPrompt: chunkSettings.qaPrompt
        }
      )
    ) {
      await delDatasetRelevantData({ datasets: [dataset], session });
    }

    await MongoDataset.findByIdAndUpdate(
      id,
      {
        ...parseParentIdInMongo(parentId),
        ...(name && { name }),
        ...(avatar && { avatar }),
        ...(agentModel && { agentModel }),
        ...(vlmModel && { vlmModel }),
        ...(websiteConfig && { websiteConfig }),
        ...(chunkSettings && { chunkSettings }),
        ...(intro !== undefined && { intro }),
        ...(externalReadUrl !== undefined && { externalReadUrl }),
        ...(!!apiServer?.baseUrl && { 'apiServer.baseUrl': apiServer.baseUrl }),
        ...(!!apiServer?.authorization && {
          'apiServer.authorization': apiServer.authorization
        }),
        ...(!!yuqueServer?.userId && { 'yuqueServer.userId': yuqueServer.userId }),
        ...(!!yuqueServer?.token && { 'yuqueServer.token': yuqueServer.token }),
        ...(!!feishuServer?.appId && { 'feishuServer.appId': feishuServer.appId }),
        ...(!!feishuServer?.appSecret && { 'feishuServer.appSecret': feishuServer.appSecret }),
        ...(!!feishuServer?.folderToken && {
          'feishuServer.folderToken': feishuServer.folderToken
        }),
        ...(isMove && { inheritPermission: true }),
        ...(typeof autoSync === 'boolean' && { autoSync })
      },
      { session }
    );
    await updateSyncSchedule({
      dataset,
      autoSync,
      session
    });

    await refreshSourceAvatar(avatar, dataset.avatar, session);
  };

  await mongoSessionRun(async (session) => {
    if (isMove) {
      if (isFolder && dataset.inheritPermission) {
        const parentClbsAndGroups = await getResourceClbsAndGroups({
          teamId: dataset.teamId,
          resourceId: parentId,
          resourceType: PerResourceTypeEnum.dataset,
          session
        });

        await syncCollaborators({
          teamId: dataset.teamId,
          resourceId: id,
          resourceType: PerResourceTypeEnum.dataset,
          collaborators: parentClbsAndGroups,
          session
        });

        await syncChildrenPermission({
          resource: dataset,
          resourceType: PerResourceTypeEnum.dataset,
          resourceModel: MongoDataset,
          folderTypeList: [DatasetTypeEnum.folder],
          collaborators: parentClbsAndGroups,
          session
        });
      } else {
        // Not folder, delete all clb
        await MongoResourcePermission.deleteMany(
          { resourceId: id, teamId: dataset.teamId, resourceType: PerResourceTypeEnum.dataset },
          { session }
        );
      }
      return onUpdate(session);
    } else {
      return onUpdate(session);
    }
  });
}
export default NextAPI(handler);

const updateTraining = async ({
  teamId,
  datasetId,
  agentModel
}: {
  teamId: string;
  datasetId: string;
  agentModel?: string;
}) => {
  if (!agentModel) return;

  await MongoDatasetTraining.updateMany(
    {
      teamId,
      datasetId,
      mode: { $in: [TrainingModeEnum.qa, TrainingModeEnum.auto] }
    },
    {
      $set: {
        model: agentModel,
        retryCount: 5,
        lockTime: new Date('2000/1/1')
      }
    }
  );
};

const updateSyncSchedule = async ({
  dataset,
  autoSync,
  session
}: {
  dataset: DatasetSchemaType;
  autoSync?: boolean;
  session: ClientSession;
}) => {
  if (typeof autoSync !== 'boolean') return;

  // Update all collection nextSyncTime
  if (dataset.type === DatasetTypeEnum.websiteDataset) {
    if (autoSync) {
      // upsert Job Scheduler
      upsertWebsiteSyncJobScheduler({ datasetId: String(dataset._id) });
    } else {
      // remove Job Scheduler
      removeWebsiteSyncJobScheduler(String(dataset._id));
    }
  } else {
    // Other dataset, update the collection sync
    if (autoSync) {
      await MongoDatasetCollection.updateMany(
        {
          teamId: dataset.teamId,
          datasetId: dataset._id,
          type: { $in: [DatasetCollectionTypeEnum.apiFile, DatasetCollectionTypeEnum.link] }
        },
        {
          $set: {
            nextSyncTime: addDays(new Date(), 1)
          }
        },
        { session }
      );
    } else {
      await MongoDatasetCollection.updateMany(
        {
          teamId: dataset.teamId,
          datasetId: dataset._id
        },
        {
          $unset: {
            nextSyncTime: 1
          }
        },
        { session }
      );
    }
  }
};
