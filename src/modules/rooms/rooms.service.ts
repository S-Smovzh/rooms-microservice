import { HttpStatus, Injectable, InternalServerErrorException } from "@nestjs/common";
import { InjectModel } from "@nestjs/mongoose";
import { Model, Types } from "mongoose";
import { v2 as cloudinary } from "cloudinary";
import { RoomDto } from "./dto/room.dto";
import { MessageDocument, NotificationsDocument, RightsDocument, RoomDocument, UserDocument } from "~/modules/schemas";
import { CloudinaryConfigInterface, ConnectionNamesEnum, LoggerService, ModelsNamesEnum, RightsEnum } from "~/modules/common";
import { GLOBAL_ERROR_CODES, GlobalErrorCodesEnum } from "@ssmovzh/chatterly-common-utils";
import { ConfigService } from "@nestjs/config";

const { ObjectId } = Types;

@Injectable()
export class RoomsService {
  constructor(
    @InjectModel(ModelsNamesEnum.ROOM, ConnectionNamesEnum.ROOM) private readonly roomModel: Model<RoomDocument>,
    @InjectModel(ModelsNamesEnum.MESSAGES, ConnectionNamesEnum.MESSAGES) private readonly messageModel: Model<MessageDocument>,
    @InjectModel(ModelsNamesEnum.RIGHTS, ConnectionNamesEnum.ROOM) private readonly rightsModel: Model<RightsDocument>,
    @InjectModel(ModelsNamesEnum.NOTIFICATIONS, ConnectionNamesEnum.ROOM) private readonly notificationsModel: Model<NotificationsDocument>,
    @InjectModel(ModelsNamesEnum.USER, ConnectionNamesEnum.USER) private readonly userModel: Model<UserDocument>,
    private readonly logger: LoggerService,
    private readonly configService: ConfigService
  ) {}

  async addWelcomeChat(userId: string): Promise<HttpStatus> {
    try {
      const welcomeChat = await this.roomModel.findOne<RoomDocument>({ name: "Chatterly" });

      welcomeChat.id = welcomeChat.id + userId;
      welcomeChat.usersID = [new ObjectId(userId)];

      await welcomeChat.save();

      await this.rightsModel.create({
        user: new ObjectId(userId),
        roomId: welcomeChat.id + userId,
        rights: [RightsEnum.DELETE_ROOM]
      });

      await this.__setUserNotificationsSettings(new ObjectId(userId), new ObjectId(welcomeChat.id + userId), true);
      return HttpStatus.CREATED;
    } catch (error) {
      this.logger.error(error, error.trace);
      const { httpCode, msg } = GLOBAL_ERROR_CODES.get(GlobalErrorCodesEnum.INTERNAL_SERVER_ERROR);
      throw new InternalServerErrorException({
        key: GlobalErrorCodesEnum.INTERNAL_SERVER_ERROR,
        code: httpCode,
        message: msg
      });
    }
  }

  async createRoom(userId: string, roomDto: RoomDto): Promise<HttpStatus> {
    try {
      const createdRoom: RoomDocument = new this.roomModel(roomDto);
      createdRoom.usersID.push(new ObjectId(userId));
      createdRoom.photo = "https://via.placeholder.com/60";
      createdRoom.recentMessage = {
        _id: "",
        text: "loading...",
        roomId: createdRoom._id as string,
        attachment: ["loading..."],
        timestamp: "loading...",
        user: {
          _id: "test",
          username: "Loading..."
        }
      };

      await this.rightsModel.create({
        user: new ObjectId(userId),
        roomId: createdRoom._id,
        rights: Object.values(RightsEnum)
      });
      await this.__setUserNotificationsSettings(new ObjectId(userId), createdRoom._id as Types.ObjectId, true);
      return HttpStatus.CREATED;
    } catch (error) {
      this.logger.error(error, error.trace);
      const { httpCode, msg } = GLOBAL_ERROR_CODES.get(GlobalErrorCodesEnum.INTERNAL_SERVER_ERROR);
      throw new InternalServerErrorException({
        key: GlobalErrorCodesEnum.INTERNAL_SERVER_ERROR,
        code: httpCode,
        message: msg
      });
    }
  }

  async getAllRooms(): Promise<(RoomDocument | { recentMessage: any })[]> {
    try {
      return await this.roomModel.find();
    } catch (error) {
      this.logger.error(error, error.trace);
      const { httpCode, msg } = GLOBAL_ERROR_CODES.get(GlobalErrorCodesEnum.INTERNAL_SERVER_ERROR);
      throw new InternalServerErrorException({
        key: GlobalErrorCodesEnum.INTERNAL_SERVER_ERROR,
        code: httpCode,
        message: msg
      });
    }
  }

  async getAllUserRooms(userId: string): Promise<
    (RoomDocument & {
      recentMessage: {
        _id: string;
        user: {
          _id: string;
          username: string;
        };
        roomId: string;
        text: string;
        attachment: string[];
        timestamp: string;
      };
    })[]
  > {
    try {
      const result: any[] = [];

      const userRooms = await this.roomModel
        .find()
        .populate("usersID", "_id firstName lastName birthday username email phoneNumber photo", this.userModel);

      // O^2
      if (!(userRooms instanceof Error)) {
        for (let i = 0; i < userRooms.length; i++) {
          const idsArrLen = userRooms[i].usersID.length;
          for (let k = 0; k < idsArrLen; k++) {
            if (userRooms[i].usersID[k]._id.toString() === userId) {
              result.push(userRooms[i]);
            }
          }
        }
      }

      return result;
    } catch (error) {
      this.logger.error(error, error.trace);
      const { httpCode, msg } = GLOBAL_ERROR_CODES.get(GlobalErrorCodesEnum.INTERNAL_SERVER_ERROR);
      throw new InternalServerErrorException({
        key: GlobalErrorCodesEnum.INTERNAL_SERVER_ERROR,
        code: httpCode,
        message: msg
      });
    }
  }

  async findRoomAndUsersByName(name: string, userId: string): Promise<RoomDocument[]> {
    try {
      const regex = new RegExp(name, "gi");
      const rooms = await this.roomModel.find({ name: regex, isPrivate: false });
      const users = await this.userModel.find({ name: regex });

      const resultSet: any = new Set();
      rooms.forEach(resultSet.add, resultSet);
      users.forEach(resultSet.add, resultSet);

      for (let i = 0; i < rooms.length; i++) {
        if (rooms[i].usersID.includes(new ObjectId(userId))) {
          resultSet.add(rooms[i]);
        }
      }

      return [...resultSet];
    } catch (error) {
      this.logger.error(error, error.trace);
      const { httpCode, msg } = GLOBAL_ERROR_CODES.get(GlobalErrorCodesEnum.INTERNAL_SERVER_ERROR);
      throw new InternalServerErrorException({
        key: GlobalErrorCodesEnum.INTERNAL_SERVER_ERROR,
        code: httpCode,
        message: msg
      });
    }
  }

  async updateRoom(rights: RightsEnum[], userId: string, roomId: string, roomDto: Partial<RoomDto>): Promise<HttpStatus | RoomDocument> {
    try {
      if (rights.includes(RightsEnum.CHANGE_ROOM) && (await this.__verifyRights(rights, new ObjectId(userId), new ObjectId(roomId)))) {
        const room = await this.roomModel.findOne({ _id: new ObjectId(roomId) });

        const updatedRoom = {
          usersID: room.usersID,
          messagesID: room.messagesID,
          _id: room._id,
          name: roomDto.name ? roomDto.name : room.name,
          description: roomDto.description ? roomDto.description : room.description,
          isUser: room.isUser,
          photo: room.photo,
          isPrivate: roomDto.isPrivate ? roomDto.isPrivate : room.isPrivate,
          membersCount: roomDto.membersCount ? roomDto.membersCount : room.membersCount,
          createdAt: room.createdAt,
          updatedAt: new Date()
        };
        await this.roomModel.updateOne({ _id: room._id }, updatedRoom);
        return await this.roomModel.findOne({ _id: new ObjectId(roomId) });
      }
      return HttpStatus.UNAUTHORIZED;
    } catch (error) {
      this.logger.error(error, error.trace);
      const { httpCode, msg } = GLOBAL_ERROR_CODES.get(GlobalErrorCodesEnum.INTERNAL_SERVER_ERROR);
      throw new InternalServerErrorException({
        key: GlobalErrorCodesEnum.INTERNAL_SERVER_ERROR,
        code: httpCode,
        message: msg
      });
    }
  }

  async changeRoomPhoto(rights: RightsEnum[], userId: string, roomId: string, photo: any): Promise<HttpStatus | RoomDocument> {
    try {
      if (rights.includes(RightsEnum.CHANGE_ROOM) && (await this.__verifyRights(rights, new ObjectId(userId), new ObjectId(roomId)))) {
        const room = await this.roomModel.findOne({ _id: new ObjectId(roomId) });
        const { apiKey, apiSecret, cloudName } = this.configService.get<CloudinaryConfigInterface>("cloudinary");

        cloudinary.config({
          cloud_name: cloudName,
          api_key: apiKey,
          api_secret: apiSecret,
          secure: true
        });

        const result = await cloudinary.uploader.upload(photo.photo, {
          overwrite: true,
          invalidate: true,
          folder: `Chatterly/${room._id}/`,
          public_id: `photo`
        });

        await this.roomModel.updateOne(
          { _id: roomId },
          {
            photo: result ? result.secure_url : room.photo
          }
        );
        await this.roomModel.findOne({ _id: new ObjectId(roomId) });
      }
      return HttpStatus.UNAUTHORIZED;
    } catch (error) {
      this.logger.error(error, error.trace);
      const { httpCode, msg } = GLOBAL_ERROR_CODES.get(GlobalErrorCodesEnum.INTERNAL_SERVER_ERROR);
      throw new InternalServerErrorException({
        key: GlobalErrorCodesEnum.INTERNAL_SERVER_ERROR,
        code: httpCode,
        message: msg
      });
    }
  }

  async deleteRoom(rights: RightsEnum[], userId: string, roomId: string): Promise<HttpStatus> {
    try {
      if (rights.includes(RightsEnum.DELETE_ROOM) && (await this.__verifyRights(rights, new ObjectId(userId), new ObjectId(roomId)))) {
        const { deletedCount } = await this.roomModel.deleteOne({ _id: new ObjectId(roomId) });

        if (deletedCount !== 0) {
          return HttpStatus.OK;
        } else {
          return HttpStatus.NOT_FOUND;
        }
      }
      return HttpStatus.UNAUTHORIZED;
    } catch (error) {
      this.logger.error(error, error.trace);
      const { httpCode, msg } = GLOBAL_ERROR_CODES.get(GlobalErrorCodesEnum.INTERNAL_SERVER_ERROR);
      throw new InternalServerErrorException({
        key: GlobalErrorCodesEnum.INTERNAL_SERVER_ERROR,
        code: httpCode,
        message: msg
      });
    }
  }

  async deleteMessageFromRoom(roomId: string, messageId: string): Promise<HttpStatus> {
    try {
      const searchResult = await this.roomModel.findOne({ _id: new ObjectId(roomId) });

      const messagePosition = searchResult.messagesID.findIndex((item) => item === new ObjectId(messageId));

      if (messagePosition > -1) {
        searchResult.messagesID.splice(messagePosition, 1);
        await this.roomModel.updateOne({ _id: new ObjectId(roomId) }, searchResult);
        return HttpStatus.CREATED;
      } else {
        return HttpStatus.NOT_FOUND;
      }
    } catch (error) {
      this.logger.error(error, error.trace);
      const { httpCode, msg } = GLOBAL_ERROR_CODES.get(GlobalErrorCodesEnum.INTERNAL_SERVER_ERROR);
      throw new InternalServerErrorException({
        key: GlobalErrorCodesEnum.INTERNAL_SERVER_ERROR,
        code: httpCode,
        message: msg
      });
    }
  }

  async addMessageReferenceToRoom(messageId: string, roomId: string): Promise<HttpStatus> {
    try {
      const searchResult = await this.roomModel.findOne({ _id: new ObjectId(roomId) });

      searchResult.messagesID.push(new ObjectId(messageId));

      await this.roomModel.updateOne({ _id: new ObjectId(roomId) }, searchResult);

      return HttpStatus.CREATED;
    } catch (error) {
      this.logger.error(error, error.trace);
      const { httpCode, msg } = GLOBAL_ERROR_CODES.get(GlobalErrorCodesEnum.INTERNAL_SERVER_ERROR);
      throw new InternalServerErrorException({
        key: GlobalErrorCodesEnum.INTERNAL_SERVER_ERROR,
        code: httpCode,
        message: msg
      });
    }
  }

  async addRecentMessage(roomId: string): Promise<HttpStatus> {
    try {
      const theLastMessage = await this.messageModel
        .find({ roomId: new ObjectId(roomId) })
        .sort({ $natural: -1 })
        .limit(1)
        .populate("user", "id username", this.userModel);

      if (!theLastMessage.length) {
        return HttpStatus.BAD_REQUEST;
      }

      const [msg] = theLastMessage;

      const recentMessage = {
        _id: msg._id,
        user: {
          _id: msg.user._id,
          username: (msg.user as UserDocument).username
        },
        roomId,
        text: msg.text,
        attachment: msg.attachment,
        timestamp: msg.timestamp
      };

      await this.roomModel.updateOne({ roomId: roomId }, { $addToSet: { recentMessage: recentMessage } });

      return HttpStatus.CREATED;
    } catch (error) {
      this.logger.error(error, error.trace);
      const { httpCode, msg } = GLOBAL_ERROR_CODES.get(GlobalErrorCodesEnum.INTERNAL_SERVER_ERROR);
      throw new InternalServerErrorException({
        key: GlobalErrorCodesEnum.INTERNAL_SERVER_ERROR,
        code: httpCode,
        message: msg
      });
    }
  }

  async enterPublicRoom(userId: string, roomId: string): Promise<HttpStatus> {
    try {
      const searchResult = await this.roomModel.findOne({ _id: new ObjectId(roomId) });

      if (searchResult) {
        searchResult.usersID.push(new ObjectId(userId));

        await this.roomModel.updateOne({ _id: new ObjectId(roomId) }, searchResult);
        await this.rightsModel.create({
          user: new ObjectId(userId),
          roomId: new ObjectId(roomId),
          rights: [RightsEnum.SEND_MESSAGES, RightsEnum.SEND_ATTACHMENTS, RightsEnum.CHANGE_MESSAGES]
        });
        return HttpStatus.OK;
      }
      return HttpStatus.BAD_REQUEST;
    } catch (error) {
      this.logger.error(error, error.trace);
      const { httpCode, msg } = GLOBAL_ERROR_CODES.get(GlobalErrorCodesEnum.INTERNAL_SERVER_ERROR);
      throw new InternalServerErrorException({
        key: GlobalErrorCodesEnum.INTERNAL_SERVER_ERROR,
        code: httpCode,
        message: msg
      });
    }
  }

  async addUserToRoom(
    rights: RightsEnum[],
    userId: string,
    roomId: string,
    newUserIdentifier: string,
    userRights: string[]
  ): Promise<HttpStatus> {
    try {
      if (rights.includes(RightsEnum.ADD_USERS) && (await this.__verifyRights(rights, new ObjectId(userId), new ObjectId(roomId)))) {
        let user: UserDocument;
        const searchResult = await this.roomModel.findOne({ _id: new ObjectId(roomId) });

        if (newUserIdentifier.includes("@")) {
          user = await this.userModel.findOne({ email: newUserIdentifier });
        } else if (newUserIdentifier.includes("+")) {
          user = await this.userModel.findOne({ phoneNumber: newUserIdentifier });
        } else {
          user = await this.userModel.findOne({ username: newUserIdentifier });
        }

        if (searchResult) {
          let userId: Types.ObjectId;

          if (user._id) {
            userId = new ObjectId(user._id as string);
          }

          searchResult.usersID.push(userId);

          await this.roomModel.updateOne({ _id: new ObjectId(roomId) }, searchResult);
          await this.rightsModel.create({
            user: userId,
            roomId: new ObjectId(roomId),
            rights: userRights
          });
          return HttpStatus.CREATED;
        }
        return HttpStatus.BAD_REQUEST;
      } else {
        return HttpStatus.UNAUTHORIZED;
      }
    } catch (error) {
      this.logger.error(error, error.trace);
      const { httpCode, msg } = GLOBAL_ERROR_CODES.get(GlobalErrorCodesEnum.INTERNAL_SERVER_ERROR);
      throw new InternalServerErrorException({
        key: GlobalErrorCodesEnum.INTERNAL_SERVER_ERROR,
        code: httpCode,
        message: msg
      });
    }
  }

  async deleteUserFromRoom(
    rights: RightsEnum[],
    userId: string,
    userIdToBeDeleted: string,
    roomId: string,
    type: "DELETE_USER" | "LEAVE_ROOM"
  ): Promise<HttpStatus> {
    try {
      let indicator = false;

      if (
        type === "DELETE_USER" &&
        rights.includes(RightsEnum.DELETE_USERS) &&
        (await this.__verifyRights(rights, new ObjectId(userId), new ObjectId(roomId)))
      ) {
        indicator = true;
      } else if (type === RightsEnum.LEAVE_ROOM) {
        indicator = new ObjectId(userId) === new ObjectId(userIdToBeDeleted);
      }

      if (indicator) {
        const searchResult = await this.roomModel.findOne({ _id: new ObjectId(roomId) });

        if (searchResult) {
          const userPosition = searchResult.usersID.findIndex((item) => item.toString() === userIdToBeDeleted);

          if (type === "LEAVE_ROOM" && searchResult.usersID.length === 1) {
            const { deletedCount } = await this.roomModel.deleteOne({ _id: new ObjectId(roomId) });

            if (deletedCount !== 0) {
              return HttpStatus.OK;
            } else {
              return HttpStatus.NOT_FOUND;
            }
          }

          if (userPosition > -1) {
            searchResult.usersID.splice(userPosition, 1);
            await this.roomModel.updateOne({ _id: new ObjectId(roomId) }, searchResult);
            return HttpStatus.CREATED;
          } else {
            return HttpStatus.NOT_FOUND;
          }
        } else {
          return HttpStatus.BAD_REQUEST;
        }
      }

      return HttpStatus.UNAUTHORIZED;
    } catch (error) {
      this.logger.error(error, error.trace);
      const { httpCode, msg } = GLOBAL_ERROR_CODES.get(GlobalErrorCodesEnum.INTERNAL_SERVER_ERROR);
      throw new InternalServerErrorException({
        key: GlobalErrorCodesEnum.INTERNAL_SERVER_ERROR,
        code: httpCode,
        message: msg
      });
    }
  }

  async changeUserRightsInRoom(
    rights: RightsEnum[],
    performerUserId: string,
    targetUserId: string,
    roomId: string,
    newRights: string[]
  ): Promise<HttpStatus> {
    try {
      if (
        rights.includes(RightsEnum.CHANGE_USER_RIGHTS) &&
        (await this.__verifyRights(rights, new ObjectId(performerUserId), new ObjectId(roomId)))
      ) {
        const nModified = await this.rightsModel.updateOne(
          { user: new ObjectId(targetUserId), roomId: new ObjectId(roomId) },
          { rights: newRights }
        );

        if (nModified) {
          return HttpStatus.CREATED;
        } else {
          return HttpStatus.BAD_REQUEST;
        }
      } else {
        return HttpStatus.UNAUTHORIZED;
      }
    } catch (error) {
      this.logger.error(error, error.trace);
      const { httpCode, msg } = GLOBAL_ERROR_CODES.get(GlobalErrorCodesEnum.INTERNAL_SERVER_ERROR);
      throw new InternalServerErrorException({
        key: GlobalErrorCodesEnum.INTERNAL_SERVER_ERROR,
        code: httpCode,
        message: msg
      });
    }
  }

  async changeNotificationSettings(userId: string, roomId: string, notifications: boolean): Promise<HttpStatus> {
    try {
      const prevNotificationsSettings = await this.notificationsModel.findOne({
        user: new ObjectId(userId),
        roomId: new ObjectId(roomId)
      });

      const updatedSettings = {
        _id: prevNotificationsSettings._id,
        user: prevNotificationsSettings.user,
        roomId: prevNotificationsSettings.roomId,
        notifications: notifications
      };

      await this.notificationsModel.updateOne(
        {
          user: new ObjectId(userId),
          roomId: new ObjectId(roomId)
        },
        updatedSettings
      );
      return HttpStatus.CREATED;
    } catch (error) {
      this.logger.error(error, error.trace);
      const { httpCode, msg } = GLOBAL_ERROR_CODES.get(GlobalErrorCodesEnum.INTERNAL_SERVER_ERROR);
      throw new InternalServerErrorException({
        key: GlobalErrorCodesEnum.INTERNAL_SERVER_ERROR,
        code: httpCode,
        message: msg
      });
    }
  }

  async getUserNotificationsSettings(userId: string): Promise<NotificationsDocument[]> {
    try {
      return await this.notificationsModel.find({ user: new ObjectId(userId) });
    } catch (error) {
      this.logger.error(error, error.trace);
      const { httpCode, msg } = GLOBAL_ERROR_CODES.get(GlobalErrorCodesEnum.INTERNAL_SERVER_ERROR);
      throw new InternalServerErrorException({
        key: GlobalErrorCodesEnum.INTERNAL_SERVER_ERROR,
        code: httpCode,
        message: msg
      });
    }
  }

  async loadRights(user: string, roomId: string): Promise<RightsDocument> {
    try {
      return await this.rightsModel.findOne({ user: new ObjectId(user), roomId: new ObjectId(roomId) });
    } catch (error) {
      this.logger.error(error, error.trace);
      const { httpCode, msg } = GLOBAL_ERROR_CODES.get(GlobalErrorCodesEnum.INTERNAL_SERVER_ERROR);
      throw new InternalServerErrorException({
        key: GlobalErrorCodesEnum.INTERNAL_SERVER_ERROR,
        code: httpCode,
        message: msg
      });
    }
  }

  private async __setUserNotificationsSettings(
    userId: Types.ObjectId,
    roomId: Types.ObjectId,
    notifications: boolean
  ): Promise<HttpStatus> {
    try {
      await this.notificationsModel.create({ user: userId, roomId: roomId, notifications });
      return HttpStatus.CREATED;
    } catch (error) {
      this.logger.error(error, error.trace);
      const { httpCode, msg } = GLOBAL_ERROR_CODES.get(GlobalErrorCodesEnum.INTERNAL_SERVER_ERROR);
      throw new InternalServerErrorException({
        key: GlobalErrorCodesEnum.INTERNAL_SERVER_ERROR,
        code: httpCode,
        message: msg
      });
    }
  }

  private async __verifyRights(rights: RightsEnum[], user: Types.ObjectId, roomId: Types.ObjectId): Promise<boolean> {
    try {
      const exists = await this.rightsModel.exists({ user, roomId, rights });
      return !!exists._id;
    } catch (error) {
      this.logger.error(error, error.trace);
      const { httpCode, msg } = GLOBAL_ERROR_CODES.get(GlobalErrorCodesEnum.INTERNAL_SERVER_ERROR);
      throw new InternalServerErrorException({
        key: GlobalErrorCodesEnum.INTERNAL_SERVER_ERROR,
        code: httpCode,
        message: msg
      });
    }
  }
}
