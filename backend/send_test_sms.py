import sys

import boto3


def main() -> int:
    if len(sys.argv) < 2:
        print("Usage: python -m backend.send_test_sms +919999999999 [message]")
        return 2

    phone = sys.argv[1]
    message = " ".join(sys.argv[2:]) or "Fortel CRM test SMS: SMS reminder setup is working."
    res = boto3.client("sns", region_name="ap-south-1").publish(
        PhoneNumber=phone,
        Message=message,
        MessageAttributes={
            "AWS.SNS.SMS.SMSType": {"DataType": "String", "StringValue": "Transactional"},
            "AWS.SNS.SMS.SenderID": {"DataType": "String", "StringValue": "FORTELCRM"},
        },
    )
    print(res.get("MessageId"))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
