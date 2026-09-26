using UnityEngine;
using System.Collections;

public class CellTouchesPlane : MonoBehaviour {

	void onCollisionEnter (Collision col)
	{
		this.GetComponent<Rigidbody> ().AddForce (0, -10, 0, ForceMode.Impulse);
	}

}
