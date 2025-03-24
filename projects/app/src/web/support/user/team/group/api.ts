import { DELETE, GET, POST, PUT } from '@/web/common/api/request';
import type {
  GroupMemberItemType,
  MemberGroupListType
} from '@fastgpt/global/support/permission/memberGroup/type';
import type {
  postCreateGroupData,
  putUpdateGroupData
} from '@fastgpt/global/support/user/team/group/api';

export const getGroupList = () => GET<MemberGroupListType>('/proApi/support/user/team/group/list');

export const postCreateGroup = (data: postCreateGroupData) =>
  POST('/proApi/support/user/team/group/create', data);

export const deleteGroup = (groupId: string) =>
  DELETE('/proApi/support/user/team/group/delete', { groupId });

export const putUpdateGroup = (data: putUpdateGroupData) =>
  PUT('/proApi/support/user/team/group/update', data);

export const getGroupMembers = (groupId: string) =>
  GET<GroupMemberItemType[]>(`/proApi/support/user/team/group/members`, { groupId });

export const putGroupChangeOwner = (groupId: string, tmbId: string) =>
  PUT(`/proApi/support/user/team/group/changeOwner`, { groupId, tmbId });
