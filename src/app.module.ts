import { ConfigModule } from "@nestjs/config";
import { Module } from "@nestjs/common";
import { MongooseModule } from "@nestjs/mongoose";
import { ConnectionNamesEnum, defaultImports, LoggerModule } from "~/modules/common";
import { HealthCheckModule } from "~/modules/health-check/health-check.module";
import { RabbitModule } from "~/modules/rabbit";
import { RoomsModule } from "~/modules/rooms/rooms.module";

@Module({
  imports: [
    ...defaultImports,
    ConfigModule.forRoot(),
    RoomsModule,
    RabbitModule,
    HealthCheckModule,
    LoggerModule,
    MongooseModule.forRoot(
      `mongodb+srv://${process.env.MONGO_USERNAME}:${process.env.MONGO_PASSWORD}@${process.env.MONGO_CLUSTER_URL}/${process.env.MONGO_USER_DATABASE_NAME}?retryWrites=true&w=majority`,
      {
        connectionName: ConnectionNamesEnum.USER
      }
    ),
    MongooseModule.forRoot(
      `mongodb+srv://${process.env.MONGO_USERNAME}:${process.env.MONGO_PASSWORD}@${process.env.MONGO_CLUSTER_URL}/${process.env.MONGO_ROOMS_DATABASE_NAME}?retryWrites=true&w=majority`,
      {
        connectionName: ConnectionNamesEnum.ROOM
      }
    ),
    MongooseModule.forRoot(
      `mongodb+srv://${process.env.MONGO_USERNAME}:${process.env.MONGO_PASSWORD}@${process.env.MONGO_CLUSTER_URL}/${process.env.MONGO_MESSAGES_DATABASE_NAME}?retryWrites=true&w=majority`,
      {
        connectionName: ConnectionNamesEnum.MESSAGES
      }
    )
  ]
})
export class AppModule {}
