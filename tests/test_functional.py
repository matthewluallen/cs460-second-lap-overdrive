import unittest
from lapreturn.core import Pilot

class FunctionalTests(unittest.TestCase):
    def test_drive_then_stop(self):
        p = Pilot()
        p.command("pilot-red","red","sim-red","drive",80,"n1")
        self.assertEqual(p.status("pilot-red")["sim-red"]["speed"],80)
        p.command("pilot-red","red","sim-red","stop",0,"n2")
        self.assertEqual(p.status("pilot-red")["sim-red"]["speed"],0)

    def test_envelope_and_invalid_token(self):
        p = Pilot()
        for value in (-1, 501, 80.5, True):
            with self.assertRaises(ValueError):
                p.command("pilot-red","red","sim-red","drive",value,"n1")
        with self.assertRaises(PermissionError):
            p.status("unknown")

    def test_invalid_action_does_not_move(self):
        p = Pilot()
        with self.assertRaises(ValueError):
            p.command("pilot-red","red","sim-red","launch",10,"n1")
        self.assertEqual(p.status("pilot-red")["sim-red"]["speed"],0)

if __name__ == "__main__":
    unittest.main()
