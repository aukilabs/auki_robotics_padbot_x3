package cn.inbot.componentnavigation.service;

import android.content.Context;

import org.greenrobot.eventbus.Subscribe;
import org.greenrobot.eventbus.ThreadMode;

import cn.inbot.basiclib.RobotBasicClient;
import cn.inbot.basiclib.domain.ReceiveDataVo;
import cn.inbot.basiclib.event.OnRobotBasicClientConnectedEvent;
import cn.inbot.basiclib.event.OnRobotBasicClientDisconnectedEvent;
import cn.inbot.basiclib.event.ReceiveBatteryInfoEvent;
import cn.inbot.basiclib.util.EventBusUtils;
import cn.inbot.componentbase.service.EventManager;
import cn.inbot.componentdata.event.OnReceivedPushMessageVoEvent;
import cn.inbot.lib.log.PBLog;

public class RobotBasicClientService {

    private static final String FLAG = "my-app";
    private Context context;
    private RobotBasicClient robotBasicClient;

    private static RobotBasicClientService2 instance;
    private RobotBasicClientService2() {
    }
    public static RobotBasicClientService2 getInstance() {
        if (instance == null) {
            synchronized (RobotBasicClientService2.class) {
                if (instance == null) {
                    instance = new RobotBasicClientService2();
                }
            }
        }
        return instance;
    }

    public void init(Context context) {
        EventBusUtils.register(this);
        this.context = context;
        RobotBasicClient.getInstance().connect(context.getApplicationContext(), FLAG);
    }

    @Subscribe(threadMode = ThreadMode.MAIN)
    public void onEvent(OnRobotBasicClientConnectedEvent event) {
        PBLog.INSTANCE.i("----connected!");

        try {
            robotBasicClient = RobotBasicClient.getInstance();
        } catch (Exception e) {
            PBLog.INSTANCE.e("设置推送配置出错:" + e);
            e.printStackTrace();
        }
    }

    @Subscribe(threadMode = ThreadMode.MAIN)
    public void onEvent(OnRobotBasicClientDisconnectedEvent event) {
        PBLog.INSTANCE.e("----disconnect!");

    }

    @Subscribe(threadMode = ThreadMode.MAIN)
    public void onEvent(ReceiveDataVo receiveDataVo) {

        PBLog.INSTANCE.i("client app收到推送数据, type:" + receiveDataVo.getMessageType() + ", data:" + receiveDataVo.getMessage());

        EventManager.post(new OnReceivedPushMessageVoEvent(receiveDataVo));
    }


    /**
     * Battery information
     * @param event
     */
    @Subscribe(threadMode = ThreadMode.MAIN)
    public void onEvent(ReceiveBatteryInfoEvent event) {
        int powerPercentage = event.getPercentage();
    }


}
