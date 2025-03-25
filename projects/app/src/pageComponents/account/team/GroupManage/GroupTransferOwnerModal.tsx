import { putGroupChangeOwner, putUpdateGroup } from '@/web/support/user/team/group/api';
import {
  Box,
  Flex,
  HStack,
  Input,
  ModalBody,
  ModalFooter,
  Button,
  useDisclosure,
  Checkbox
} from '@chakra-ui/react';
import { TeamMemberItemType } from '@fastgpt/global/support/user/team/type';
import Avatar from '@fastgpt/web/components/common/Avatar';
import MyModal from '@fastgpt/web/components/common/MyModal';
import { useRequest2 } from '@fastgpt/web/hooks/useRequest';
import { useTranslation } from 'next-i18next';
import React, { useMemo, useState } from 'react';
import { TeamContext } from '../context';
import { useContextSelector } from 'use-context-selector';
import { MemberGroupListType } from '@fastgpt/global/support/permission/memberGroup/type';
import { GetSearchUserGroupOrg } from '@/web/support/user/api';
import { Omit } from '@fastgpt/web/components/common/DndDrag';

export type ChangeOwnerModalProps = {
  groupId: string;
  groups: MemberGroupListType;
  refetchGroups: () => void;
};

export function ChangeOwnerModal({
  onClose,
  groupId,
  groups,
  refetchGroups
}: ChangeOwnerModalProps & { onClose: () => void }) {
  const { t } = useTranslation();
  const [inputValue, setInputValue] = React.useState('');
  const { data: searchedData } = useRequest2(
    async () => {
      if (!inputValue) return;
      return GetSearchUserGroupOrg(inputValue);
    },
    {
      manual: false,
      refreshDeps: [inputValue],
      throttleWait: 500,
      debounceWait: 200
    }
  );

  const { members: allMembers } = useContextSelector(TeamContext, (v) => v);
  const group = useMemo(() => {
    return groups.find((item) => item._id === groupId);
  }, [groupId, groups]);

  const memberList = searchedData ? searchedData.members : allMembers;

  const [keepAdmin, setKeepAdmin] = useState(true);

  const {
    isOpen: isOpenMemberListMenu,
    onClose: onCloseMemberListMenu,
    onOpen: onOpenMemberListMenu
  } = useDisclosure();

  const [selectedMember, setSelectedMember] = useState<Omit<
    TeamMemberItemType,
    'permission' | 'teamId'
  > | null>(null);

  const { runAsync, loading } = useRequest2(
    (tmbId: string) => putGroupChangeOwner(groupId, tmbId),
    {
      onSuccess: () => Promise.all([onClose(), refetchGroups()]),
      successToast: t('common:permission.change_owner_success'),
      errorToast: t('common:permission.change_owner_failed')
    }
  );

  const onConfirm = async () => {
    if (!selectedMember) {
      return;
    }
    await runAsync(selectedMember.tmbId);
  };

  return (
    <MyModal
      isOpen
      iconSrc="modal/changePer"
      iconColor="primary.600"
      onClose={onClose}
      title={t('common:permission.change_owner')}
      isLoading={loading}
    >
      <ModalBody>
        <HStack>
          <Avatar src={group?.avatar} w={'1.75rem'} borderRadius={'md'} />
          <Box>{group?.name}</Box>
        </HStack>
        <Flex mt={4} justify="start" flexDirection="column">
          <Box fontSize="14px" fontWeight="500" color="myGray.900">
            {t('common:permission.change_owner_to')}
          </Box>
          <Flex mt="4" alignItems="center" position={'relative'}>
            {selectedMember && (
              <Avatar
                src={selectedMember.avatar}
                w={'20px'}
                borderRadius={'md'}
                position="absolute"
                left={3}
              />
            )}
            <Input
              placeholder={t('common:permission.change_owner_placeholder')}
              value={inputValue}
              onChange={(e) => {
                setInputValue(e.target.value);
                setSelectedMember(null);
              }}
              onFocus={() => {
                onOpenMemberListMenu();
                setSelectedMember(null);
              }}
              {...(selectedMember && { pl: '10' })}
            />
          </Flex>
          {isOpenMemberListMenu && memberList.length > 0 && (
            <Flex
              mt={2}
              w={'100%'}
              flexDirection={'column'}
              gap={2}
              p={1}
              boxShadow="lg"
              bg="white"
              borderRadius="md"
              zIndex={10}
              maxH={'300px'}
              overflow={'auto'}
            >
              {memberList.map((item) => (
                <Box
                  key={item.tmbId}
                  p="2"
                  _hover={{ bg: 'myGray.100' }}
                  mx="1"
                  borderRadius="md"
                  cursor={'pointer'}
                  onClickCapture={() => {
                    setInputValue(item.memberName);
                    setSelectedMember(item);
                    onCloseMemberListMenu();
                  }}
                >
                  <Flex align="center">
                    <Avatar src={item.avatar} w="1.25rem" />
                    <Box ml="2">{item.memberName}</Box>
                  </Flex>
                </Box>
              ))}
            </Flex>
          )}

          <Box mt="4">
            <Checkbox
              isChecked={keepAdmin}
              onChange={(e) => {
                setKeepAdmin(e.target.checked);
              }}
            >
              {t('account_team:retain_admin_permissions')}
            </Checkbox>
          </Box>
        </Flex>
      </ModalBody>
      <ModalFooter>
        <HStack>
          <Button onClick={onClose} variant={'whiteBase'}>
            {t('common:common.Cancel')}
          </Button>
          <Button onClick={onConfirm}>{t('common:common.Confirm')}</Button>
        </HStack>
      </ModalFooter>
    </MyModal>
  );
}

export default ChangeOwnerModal;
