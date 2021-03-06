import { Schema, SchemaFactory, Prop } from "@nestjs/mongoose";
import { Document, Types } from "mongoose";
import { RecentMessageDto } from "../dto/recentMessage.dto";

export type RoomDocument = Room & Document;

@Schema()
class Room {
  @Prop({ required: true, index: false })
  name: string;

  @Prop({ required: false, index: false })
  description: string;

  @Prop({ required: false, index: false })
  photo: string;

  @Prop({ required: true, index: false })
  isUser: boolean;

  @Prop({ required: true, index: false })
  isPrivate: boolean;

  @Prop({ required: true, index: false, ref: "User", type: [Types.ObjectId] })
  usersID: Types.ObjectId[];

  @Prop({ required: true, index: true, ref: "Messages", type: [Types.ObjectId] })
  messagesID: Types.ObjectId[];

  @Prop({ required: false, index: true })
  recentMessage: RecentMessageDto;

  @Prop({ required: true, index: false })
  membersCount: number;

  @Prop({ required: true, index: false })
  createdAt: string;
}

export const RoomSchema = SchemaFactory.createForClass(Room);
