import type { NextApiResponse } from 'next';
import { ApiRequestProps } from '@fastgpt/service/type/next';
import { NextAPI } from '@/service/middleware/entry';
import { InitDateResponse } from '@/global/common/api/systemRes';
import { SystemModelItemType } from '@fastgpt/service/core/ai/type';
import { authCert } from '@fastgpt/service/support/permission/auth/common';

async function handler(
  req: ApiRequestProps<{}, { bufferId?: string }>,
  res: NextApiResponse
): Promise<InitDateResponse> {
  const { bufferId } = req.query;

  const activeModelList = global.systemActiveModelList.map((model) => ({
    ...model,
    customCQPrompt: undefined,
    customExtractPrompt: undefined,
    defaultSystemChatPrompt: undefined,
    fieldMap: undefined,
    defaultConfig: undefined,
    weight: undefined,
    dbConfig: undefined,
    queryConfig: undefined,
    requestUrl: undefined,
    requestAuth: undefined
  })) as SystemModelItemType[];

  try {
    await authCert({ req, authToken: true });
    // If bufferId is the same as the current bufferId, return directly
    if (bufferId && global.systemInitBufferId && global.systemInitBufferId === bufferId) {
      return {
        bufferId: global.systemInitBufferId,
        systemVersion: global.systemVersion
      };
    }

    return {
      bufferId: global.systemInitBufferId,
      feConfigs: global.feConfigs,
      subPlans: global.subPlans,
      systemVersion: global.systemVersion,
      activeModelList,
      defaultModels: global.systemDefaultModel
    };
  } catch (error) {
    const unAuthBufferId = global.systemInitBufferId ? `unAuth_${global.systemInitBufferId}` : '';
    if (bufferId && unAuthBufferId === bufferId) {
      return {
        bufferId: unAuthBufferId
      };
    }
    return {
      bufferId: unAuthBufferId,
      feConfigs: global.feConfigs
    };
  }
}

export default NextAPI(handler);
