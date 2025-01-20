import {
  DatasetSearchModeEnum,
  DatasetSearchModeMap,
  SearchScoreTypeEnum
} from '@fastgpt/global/core/dataset/constants';
import { recallFromVectorStore } from '../../../common/vectorStore/controller';
import { getVectorsByText } from '../../ai/embedding';
import { getVectorModel } from '../../ai/model';
import { MongoDatasetData } from '../data/schema';
import {
  DatasetDataSchemaType,
  DatasetDataTextSchemaType,
  SearchDataResponseItemType
} from '@fastgpt/global/core/dataset/type';
import { MongoDatasetCollection } from '../collection/schema';
import { reRankRecall } from '../../../core/ai/rerank';
import { countPromptTokens } from '../../../common/string/tiktoken/index';
import { datasetSearchResultConcat } from '@fastgpt/global/core/dataset/search/utils';
import { hashStr } from '@fastgpt/global/common/string/tools';
import { jiebaSplit } from '../../../common/string/jieba';
import { getCollectionSourceData } from '@fastgpt/global/core/dataset/collection/utils';
import { Types } from '../../../common/mongo';
import json5 from 'json5';
import { MongoDatasetCollectionTags } from '../tag/schema';
import { readFromSecondary } from '../../../common/mongo/utils';
import { MongoDatasetDataText } from '../data/dataTextSchema';

type SearchDatasetDataProps = {
  teamId: string;
  model: string;
  similarity?: number; // min distance
  limit: number; // max Token limit
  datasetIds: string[];
  searchMode?: `${DatasetSearchModeEnum}`;
  usingReRank?: boolean;
  reRankQuery: string;
  queries: string[];

  /* 
    {
      tags: {
        $and: ["str1","str2"],
        $or: ["str1","str2",null] null means no tags
      },
      createTime: {
        $gte: 'xx',
        $lte: 'xxx'
      }
    }
  */
  collectionFilterMatch?: string;
};

export async function searchDatasetData(props: SearchDatasetDataProps) {
  let {
    teamId,
    reRankQuery,
    queries,
    model,
    similarity = 0,
    limit: maxTokens,
    searchMode = DatasetSearchModeEnum.embedding,
    usingReRank = false,
    datasetIds = [],
    collectionFilterMatch
  } = props;

  /* init params */
  searchMode = DatasetSearchModeMap[searchMode] ? searchMode : DatasetSearchModeEnum.embedding;
  usingReRank = usingReRank && global.reRankModels.length > 0;

  // Compatible with topk limit
  let set = new Set<string>();
  let usingSimilarityFilter = false;

  /* function */
  const countRecallLimit = () => {
    if (searchMode === DatasetSearchModeEnum.embedding) {
      return {
        embeddingLimit: 100,
        fullTextLimit: 0
      };
    }
    if (searchMode === DatasetSearchModeEnum.fullTextRecall) {
      return {
        embeddingLimit: 0,
        fullTextLimit: 100
      };
    }
    return {
      embeddingLimit: 80,
      fullTextLimit: 60
    };
  };
  const getForbidData = async () => {
    const collections = await MongoDatasetCollection.find(
      {
        teamId,
        datasetId: { $in: datasetIds },
        forbid: true
      },
      '_id'
    );

    return {
      forbidCollectionIdList: collections.map((item) => String(item._id))
    };
  };
  /* 
    Collection metadata filter
    标签过滤：
    1. and 先生效
    2. and 标签和 null 不能共存，否则返回空数组
  */
  const filterCollectionByMetadata = async (): Promise<string[] | undefined> => {
    if (!collectionFilterMatch || !global.feConfigs.isPlus) return;

    let tagCollectionIdList: string[] | undefined = undefined;
    let createTimeCollectionIdList: string[] | undefined = undefined;

    try {
      const jsonMatch =
        typeof collectionFilterMatch === 'object'
          ? collectionFilterMatch
          : json5.parse(collectionFilterMatch);

      // Tag
      let andTags = jsonMatch?.tags?.$and as (string | null)[] | undefined;
      let orTags = jsonMatch?.tags?.$or as (string | null)[] | undefined;

      // get andTagIds
      if (andTags && andTags.length > 0) {
        // tag 去重
        andTags = Array.from(new Set(andTags));

        if (andTags.includes(null) && andTags.some((tag) => typeof tag === 'string')) {
          return [];
        }

        if (andTags.every((tag) => typeof tag === 'string')) {
          // Get tagId by tag string
          const andTagIdList = await MongoDatasetCollectionTags.find(
            {
              teamId,
              datasetId: { $in: datasetIds },
              tag: { $in: andTags }
            },
            '_id',
            {
              ...readFromSecondary
            }
          ).lean();

          // If you enter a tag that does not exist, none will be found
          if (andTagIdList.length !== andTags.length) return [];

          // Get collectionId by tagId
          const collections = await MongoDatasetCollection.find(
            {
              teamId,
              datasetId: { $in: datasetIds },
              tags: { $all: andTagIdList.map((item) => String(item._id)) }
            },
            '_id',
            {
              ...readFromSecondary
            }
          ).lean();
          tagCollectionIdList = collections.map((item) => String(item._id));
        } else if (andTags.every((tag) => tag === null)) {
          const collections = await MongoDatasetCollection.find(
            {
              teamId,
              datasetId: { $in: datasetIds },
              $or: [{ tags: { $size: 0 } }, { tags: { $exists: false } }]
            },
            '_id',
            {
              ...readFromSecondary
            }
          ).lean();
          tagCollectionIdList = collections.map((item) => String(item._id));
        }
      } else if (orTags && orTags.length > 0) {
        // Get tagId by tag string
        const orTagArray = await MongoDatasetCollectionTags.find(
          {
            teamId,
            datasetId: { $in: datasetIds },
            tag: { $in: orTags.filter((tag) => tag !== null) }
          },
          '_id',
          { ...readFromSecondary }
        ).lean();
        const orTagIds = orTagArray.map((item) => String(item._id));

        // Get collections by tagId
        const collections = await MongoDatasetCollection.find(
          {
            teamId,
            datasetId: { $in: datasetIds },
            $or: [
              { tags: { $in: orTagIds } },
              ...(orTags.includes(null) ? [{ tags: { $size: 0 } }] : [])
            ]
          },
          '_id',
          { ...readFromSecondary }
        ).lean();

        tagCollectionIdList = collections.map((item) => String(item._id));
      }

      // time
      const getCreateTime = jsonMatch?.createTime?.$gte as string | undefined;
      const lteCreateTime = jsonMatch?.createTime?.$lte as string | undefined;
      if (getCreateTime || lteCreateTime) {
        const collections = await MongoDatasetCollection.find(
          {
            teamId,
            datasetId: { $in: datasetIds },
            createTime: {
              ...(getCreateTime && { $gte: new Date(getCreateTime) }),
              ...(lteCreateTime && {
                $lte: new Date(lteCreateTime)
              })
            }
          },
          '_id'
        );
        createTimeCollectionIdList = collections.map((item) => String(item._id));
      }

      // Concat tag and time
      if (tagCollectionIdList && createTimeCollectionIdList) {
        return tagCollectionIdList.filter((id) => createTimeCollectionIdList!.includes(id));
      } else if (tagCollectionIdList) {
        return tagCollectionIdList;
      } else if (createTimeCollectionIdList) {
        return createTimeCollectionIdList;
      }
    } catch (error) {}
  };
  const embeddingRecall = async ({
    query,
    limit,
    forbidCollectionIdList,
    filterCollectionIdList
  }: {
    query: string;
    limit: number;
    forbidCollectionIdList: string[];
    filterCollectionIdList?: string[];
  }) => {
    const { vectors, tokens } = await getVectorsByText({
      model: getVectorModel(model),
      input: query,
      type: 'query'
    });

    const { results } = await recallFromVectorStore({
      teamId,
      datasetIds,
      vector: vectors[0],
      limit,
      forbidCollectionIdList,
      filterCollectionIdList
    });

    // Get data and collections
    const collectionIdList = Array.from(new Set(results.map((item) => item.collectionId)));
    const [dataList, collections] = await Promise.all([
      MongoDatasetData.find(
        {
          teamId,
          datasetId: { $in: datasetIds },
          collectionId: { $in: collectionIdList },
          'indexes.dataId': { $in: results.map((item) => item.id?.trim()) }
        },
        '_id datasetId collectionId updateTime q a chunkIndex indexes',
        { ...readFromSecondary }
      ).lean(),
      MongoDatasetCollection.find(
        {
          _id: { $in: collectionIdList }
        },
        '_id name fileId rawLink apiFileId externalFileId externalFileUrl',
        { ...readFromSecondary }
      ).lean()
    ]);

    const formatResult = results
      .map((item, index) => {
        const collection = collections.find((col) => String(col._id) === String(item.collectionId));
        if (!collection) {
          console.log('Collection is not found', item);
          return;
        }
        const data = dataList.find((data) =>
          data.indexes.some((index) => index.dataId === item.id)
        );
        if (!data) {
          console.log('Data is not found', item);
          return;
        }

        const score = item?.score || 0;

        const result: SearchDataResponseItemType = {
          id: String(data._id),
          updateTime: data.updateTime,
          q: data.q,
          a: data.a,
          chunkIndex: data.chunkIndex,
          datasetId: String(data.datasetId),
          collectionId: String(data.collectionId),
          ...getCollectionSourceData(collection),
          score: [{ type: SearchScoreTypeEnum.embedding, value: score, index }]
        };

        return result;
      })
      .filter(Boolean) as SearchDataResponseItemType[];

    return {
      embeddingRecallResults: formatResult,
      tokens
    };
  };
  const fullTextRecall = async ({
    query,
    limit,
    filterCollectionIdList,
    forbidCollectionIdList
  }: {
    query: string;
    limit: number;
    filterCollectionIdList?: string[];
    forbidCollectionIdList: string[];
  }): Promise<{
    fullTextRecallResults: SearchDataResponseItemType[];
    tokenLen: number;
  }> => {
    if (limit === 0) {
      return {
        fullTextRecallResults: [],
        tokenLen: 0
      };
    }

    const searchResults = (
      await Promise.all(
        datasetIds.map(async (id) => {
          return MongoDatasetData.aggregate(
            [
              {
                $match: {
                  teamId: new Types.ObjectId(teamId),
                  datasetId: new Types.ObjectId(id),
                  $text: { $search: jiebaSplit({ text: query }) },
                  ...(filterCollectionIdList
                    ? {
                        collectionId: {
                          $in: filterCollectionIdList.map((id) => new Types.ObjectId(id))
                        }
                      }
                    : {}),
                  ...(forbidCollectionIdList && forbidCollectionIdList.length > 0
                    ? {
                        collectionId: {
                          $nin: forbidCollectionIdList.map((id) => new Types.ObjectId(id))
                        }
                      }
                    : {})
                }
              },
              {
                $sort: {
                  score: { $meta: 'textScore' }
                }
              },
              {
                $limit: limit
              },
              {
                $project: {
                  _id: 1,
                  datasetId: 1,
                  collectionId: 1,
                  updateTime: 1,
                  q: 1,
                  a: 1,
                  chunkIndex: 1,
                  score: { $meta: 'textScore' }
                }
              }
            ],
            {
              ...readFromSecondary
            }
          );
        })
      )
    ).flat() as (DatasetDataSchemaType & { score: number })[];

    // Get data and collections
    const collections = await MongoDatasetCollection.find(
      {
        _id: { $in: searchResults.map((item) => item.collectionId) }
      },
      '_id name fileId rawLink externalFileId externalFileUrl',
      { ...readFromSecondary }
    ).lean();

    return {
      fullTextRecallResults: searchResults
        .map((data, index) => {
          const collection = collections.find(
            (col) => String(col._id) === String(data.collectionId)
          );
          if (!collection) {
            console.log('Collection is not found', data);
            return;
          }

          return {
            id: String(data._id),
            datasetId: String(data.datasetId),
            collectionId: String(data.collectionId),
            updateTime: data.updateTime,
            q: data.q,
            a: data.a,
            chunkIndex: data.chunkIndex,
            indexes: data.indexes,
            ...getCollectionSourceData(collection),
            score: [{ type: SearchScoreTypeEnum.fullText, value: data.score ?? 0, index }]
          };
        })
        .filter(Boolean) as SearchDataResponseItemType[],
      tokenLen: 0
    };
  };
  const fullTextRecall2 = async ({
    query,
    limit,
    filterCollectionIdList,
    forbidCollectionIdList
  }: {
    query: string;
    limit: number;
    filterCollectionIdList?: string[];
    forbidCollectionIdList: string[];
  }): Promise<{
    fullTextRecallResults: SearchDataResponseItemType[];
    tokenLen: number;
  }> => {
    if (limit === 0) {
      return {
        fullTextRecallResults: [],
        tokenLen: 0
      };
    }

    const searchResults = (
      await Promise.all(
        datasetIds.map(async (id) => {
          return MongoDatasetDataText.aggregate(
            [
              {
                $match: {
                  teamId: new Types.ObjectId(teamId),
                  datasetId: new Types.ObjectId(id),
                  $text: { $search: jiebaSplit({ text: query }) },
                  ...(filterCollectionIdList
                    ? {
                        collectionId: {
                          $in: filterCollectionIdList.map((id) => new Types.ObjectId(id))
                        }
                      }
                    : {}),
                  ...(forbidCollectionIdList && forbidCollectionIdList.length > 0
                    ? {
                        collectionId: {
                          $nin: forbidCollectionIdList.map((id) => new Types.ObjectId(id))
                        }
                      }
                    : {})
                }
              },
              {
                $sort: {
                  score: { $meta: 'textScore' }
                }
              },
              {
                $limit: limit
              },
              {
                $project: {
                  _id: 1,
                  collectionId: 1,
                  dataId: 1,
                  score: { $meta: 'textScore' }
                }
              }
            ],
            {
              ...readFromSecondary
            }
          );
        })
      )
    ).flat() as (DatasetDataTextSchemaType & { score: number })[];

    // Get data and collections
    const [dataList, collections] = await Promise.all([
      MongoDatasetData.find(
        {
          _id: { $in: searchResults.map((item) => item.dataId) }
        },
        '_id datasetId collectionId updateTime q a chunkIndex indexes',
        { ...readFromSecondary }
      ).lean(),
      MongoDatasetCollection.find(
        {
          _id: { $in: searchResults.map((item) => item.collectionId) }
        },
        '_id name fileId rawLink apiFileId externalFileId externalFileUrl',
        { ...readFromSecondary }
      ).lean()
    ]);

    return {
      fullTextRecallResults: searchResults
        .map((item, index) => {
          const collection = collections.find(
            (col) => String(col._id) === String(item.collectionId)
          );
          if (!collection) {
            console.log('Collection is not found', item);
            return;
          }
          const data = dataList.find((data) => String(data._id) === String(item.dataId));
          if (!data) {
            console.log('Data is not found', item);
            return;
          }

          return {
            id: String(data._id),
            datasetId: String(data.datasetId),
            collectionId: String(data.collectionId),
            updateTime: data.updateTime,
            q: data.q,
            a: data.a,
            chunkIndex: data.chunkIndex,
            indexes: data.indexes,
            ...getCollectionSourceData(collection),
            score: [
              {
                type: SearchScoreTypeEnum.fullText,
                value: item.score || 0,
                index
              }
            ]
          };
        })
        .filter(Boolean) as SearchDataResponseItemType[],
      tokenLen: 0
    };
  };
  const reRankSearchResult = async ({
    data,
    query
  }: {
    data: SearchDataResponseItemType[];
    query: string;
  }): Promise<SearchDataResponseItemType[]> => {
    try {
      const results = await reRankRecall({
        query,
        documents: data.map((item) => ({
          id: item.id,
          text: `${item.q}\n${item.a}`
        }))
      });

      if (results.length === 0) {
        usingReRank = false;
        return [];
      }

      // add new score to data
      const mergeResult = results
        .map((item, index) => {
          const target = data.find((dataItem) => dataItem.id === item.id);
          if (!target) return null;
          const score = item.score || 0;

          return {
            ...target,
            score: [{ type: SearchScoreTypeEnum.reRank, value: score, index }]
          };
        })
        .filter(Boolean) as SearchDataResponseItemType[];

      return mergeResult;
    } catch (error) {
      usingReRank = false;
      return [];
    }
  };
  const multiQueryRecall = async ({
    embeddingLimit,
    fullTextLimit
  }: {
    embeddingLimit: number;
    fullTextLimit: number;
  }) => {
    // multi query recall
    const embeddingRecallResList: SearchDataResponseItemType[][] = [];
    const fullTextRecallResList: SearchDataResponseItemType[][] = [];
    let totalTokens = 0;

    const [{ forbidCollectionIdList }, filterCollectionIdList] = await Promise.all([
      getForbidData(),
      filterCollectionByMetadata()
    ]);

    await Promise.all(
      queries.map(async (query) => {
        const [{ tokens, embeddingRecallResults }, { fullTextRecallResults }] = await Promise.all([
          embeddingRecall({
            query,
            limit: embeddingLimit,
            forbidCollectionIdList,
            filterCollectionIdList
          }),
          // FullText tmp
          fullTextRecall2({
            query,
            limit: fullTextLimit,
            filterCollectionIdList,
            forbidCollectionIdList
          })
        ]);
        totalTokens += tokens;

        embeddingRecallResList.push(embeddingRecallResults);
        fullTextRecallResList.push(fullTextRecallResults);
      })
    );

    // rrf concat
    const rrfEmbRecall = datasetSearchResultConcat(
      embeddingRecallResList.map((list) => ({ k: 60, list }))
    ).slice(0, embeddingLimit);
    const rrfFTRecall = datasetSearchResultConcat(
      fullTextRecallResList.map((list) => ({ k: 60, list }))
    ).slice(0, fullTextLimit);

    return {
      tokens: totalTokens,
      embeddingRecallResults: rrfEmbRecall,
      fullTextRecallResults: rrfFTRecall
    };
  };

  /* main step */
  // count limit
  const { embeddingLimit, fullTextLimit } = countRecallLimit();

  // recall
  const { embeddingRecallResults, fullTextRecallResults, tokens } = await multiQueryRecall({
    embeddingLimit,
    fullTextLimit
  });

  // ReRank results
  const reRankResults = await (async () => {
    if (!usingReRank) return [];

    set = new Set<string>(embeddingRecallResults.map((item) => item.id));
    const concatRecallResults = embeddingRecallResults.concat(
      fullTextRecallResults.filter((item) => !set.has(item.id))
    );

    // remove same q and a data
    set = new Set<string>();
    const filterSameDataResults = concatRecallResults.filter((item) => {
      // 删除所有的标点符号与空格等，只对文本进行比较
      const str = hashStr(`${item.q}${item.a}`.replace(/[^\p{L}\p{N}]/gu, ''));
      if (set.has(str)) return false;
      set.add(str);
      return true;
    });
    return reRankSearchResult({
      query: reRankQuery,
      data: filterSameDataResults
    });
  })();

  // embedding recall and fullText recall rrf concat
  const rrfConcatResults = datasetSearchResultConcat([
    { k: 60, list: embeddingRecallResults },
    { k: 60, list: fullTextRecallResults },
    { k: 58, list: reRankResults }
  ]);

  // remove same q and a data
  set = new Set<string>();
  const filterSameDataResults = rrfConcatResults.filter((item) => {
    // 删除所有的标点符号与空格等，只对文本进行比较
    const str = hashStr(`${item.q}${item.a}`.replace(/[^\p{L}\p{N}]/gu, ''));
    if (set.has(str)) return false;
    set.add(str);
    return true;
  });

  // score filter
  const scoreFilter = (() => {
    if (usingReRank) {
      usingSimilarityFilter = true;

      return filterSameDataResults.filter((item) => {
        const reRankScore = item.score.find((item) => item.type === SearchScoreTypeEnum.reRank);
        if (reRankScore && reRankScore.value < similarity) return false;
        return true;
      });
    }
    if (searchMode === DatasetSearchModeEnum.embedding) {
      usingSimilarityFilter = true;
      return filterSameDataResults.filter((item) => {
        const embeddingScore = item.score.find(
          (item) => item.type === SearchScoreTypeEnum.embedding
        );
        if (embeddingScore && embeddingScore.value < similarity) return false;
        return true;
      });
    }
    return filterSameDataResults;
  })();

  // token filter
  const filterMaxTokensResult = await (async () => {
    const tokensScoreFilter = await Promise.all(
      scoreFilter.map(async (item) => ({
        ...item,
        tokens: await countPromptTokens(item.q + item.a)
      }))
    );

    const results: SearchDataResponseItemType[] = [];
    let totalTokens = 0;

    for await (const item of tokensScoreFilter) {
      totalTokens += item.tokens;

      if (totalTokens > maxTokens + 500) {
        break;
      }
      results.push(item);
      if (totalTokens > maxTokens) {
        break;
      }
    }

    return results.length === 0 ? scoreFilter.slice(0, 1) : results;
  })();

  return {
    searchRes: filterMaxTokensResult,
    tokens,
    searchMode,
    limit: maxTokens,
    similarity,
    usingReRank,
    usingSimilarityFilter
  };
}
