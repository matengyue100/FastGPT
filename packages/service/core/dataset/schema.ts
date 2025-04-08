import { getMongoModel, Schema } from '../../common/mongo';
import {
  ChunkSettingModeEnum,
  DataChunkSplitModeEnum,
  DatasetCollectionDataProcessModeEnum,
  DatasetTypeEnum,
  DatasetTypeMap
} from '@fastgpt/global/core/dataset/constants';
import {
  TeamCollectionName,
  TeamMemberCollectionName
} from '@fastgpt/global/support/user/team/constant';
import type { DatasetSchemaType } from '@fastgpt/global/core/dataset/type.d';

export const DatasetCollectionName = 'datasets';

export const ChunkSettings = {
  imageIndex: Boolean,
  autoIndexes: Boolean,
  trainingType: {
    type: String,
    enum: Object.values(DatasetCollectionDataProcessModeEnum)
  },
  chunkSettingMode: {
    type: String,
    enum: Object.values(ChunkSettingModeEnum)
  },
  chunkSplitMode: {
    type: String,
    enum: Object.values(DataChunkSplitModeEnum)
  },
  chunkSize: Number,
  chunkSplitter: String,

  indexSize: Number,
  qaPrompt: String
};

const DatasetSchema = new Schema({
  parentId: {
    type: Schema.Types.ObjectId,
    ref: DatasetCollectionName,
    default: null
  },
  userId: {
    //abandon
    type: Schema.Types.ObjectId,
    ref: 'user'
  },
  teamId: {
    type: Schema.Types.ObjectId,
    ref: TeamCollectionName,
    required: true
  },
  tmbId: {
    type: Schema.Types.ObjectId,
    ref: TeamMemberCollectionName,
    required: true
  },
  type: {
    type: String,
    enum: Object.keys(DatasetTypeMap),
    required: true,
    default: DatasetTypeEnum.dataset
  },
  avatar: {
    type: String,
    default: '/icon/logo.svg'
  },
  name: {
    type: String,
    required: true
  },
  updateTime: {
    type: Date,
    default: () => new Date()
  },
  vectorModel: {
    type: String,
    required: true,
    default: 'text-embedding-3-small'
  },
  agentModel: {
    type: String,
    required: true,
    default: 'gpt-4o-mini'
  },
  vlmModel: String,
  intro: {
    type: String,
    default: ''
  },
  websiteConfig: {
    type: {
      url: {
        type: String,
        required: true
      },
      selector: {
        type: String,
        default: 'body'
      }
    }
  },
  chunkSettings: {
    type: ChunkSettings
  },
  inheritPermission: {
    type: Boolean,
    default: true
  },
  apiServer: {
    type: Object
  },
  feishuServer: {
    type: Object
  },
  yuqueServer: {
    type: Object
  },

  // abandoned
  autoSync: Boolean,
  externalReadUrl: {
    type: String
  },
  defaultPermission: Number
});

try {
  DatasetSchema.index({ teamId: 1 });
} catch (error) {
  console.log(error);
}

export const MongoDataset = getMongoModel<DatasetSchemaType>(DatasetCollectionName, DatasetSchema);
