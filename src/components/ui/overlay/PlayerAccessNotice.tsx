"use client";

import { Button, Modal, ModalBody, ModalContent, ModalFooter, ModalHeader } from "@heroui/react";

interface PlayerAccessNoticeProps {
  isOpen: boolean;
  onClose: () => void;
  missingRequirements: string[];
}

const PlayerAccessNotice: React.FC<PlayerAccessNoticeProps> = ({
  isOpen,
  onClose,
  missingRequirements,
}) => {
  if (!missingRequirements.length) return null;

  const isMissingSignIn = missingRequirements.some((item) => item.toLowerCase().includes("sign in"));
  const isMissingAdblock = missingRequirements.some((item) =>
    item.toLowerCase().includes("ad blocker"),
  );

  return (
    <Modal isOpen={isOpen} placement="center" backdrop="blur" onClose={onClose}>
      <ModalContent>
        <ModalHeader className="text-center text-2xl">321 Player Requirements</ModalHeader>
        <ModalBody className="space-y-3">
          <p>321 Player is only available when all requirements are met:</p>
          <ul className="list-disc space-y-1 pl-5">
            <li className={isMissingSignIn ? "text-warning-300" : "text-success-300"}>
              Sign in to your account.
            </li>
            <li className={isMissingAdblock ? "text-warning-300" : "text-success-300"}>
              Disable your ad blocker for this site.
            </li>
          </ul>
          <p>You can still watch using other sources from the source selector.</p>
        </ModalBody>
        <ModalFooter className="justify-center">
          <Button color="primary" onPress={onClose}>
            Use Other Sources
          </Button>
        </ModalFooter>
      </ModalContent>
    </Modal>
  );
};

export default PlayerAccessNotice;
